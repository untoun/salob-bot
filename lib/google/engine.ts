import { createHash } from "node:crypto";

/** Абстракция над Google Sheets API — позволяет тестировать движок без сети. */
export interface SheetDef {
  name: string;
  headers: string[]; // видимые заголовки
  hashColumn: boolean; // добавлять служебную колонку _hash (двусторонние листы)
  statusColumn?: { index: number; options: string[] }; // выпадающий список
}

export interface SheetsIO {
  ensure(defs: SheetDef[]): Promise<void>;
  /** строки начиная со 2-й, выровненные по ширине width */
  read(sheet: string, width: number): Promise<string[][]>;
  update(sheet: string, width: number, updates: { row: number; values: string[] }[]): Promise<void>;
  append(sheet: string, rows: string[][]): Promise<void>;
  replace(sheet: string, width: number, rows: string[][]): Promise<void>;
}

export type EditResult = "applied" | "rejected" | "noop" | "unknown";

export interface EntitySpec {
  entityType: string;
  sheet: string;
  headers: string[];
  /** индексы колонок, которые администратор может править в таблице */
  editable: number[];
  /** строки для записи в таблицу (ячейки без хеша) */
  load(ids: string[]): Promise<{ id: string; cells: string[] }[]>;
  /** id всех сущностей, которые должны присутствовать в таблице (для сверки) */
  loadRecentIds(): Promise<string[]>;
  /** values — значения редактируемых колонок в порядке `editable` */
  applyEdit(id: string, values: string[]): Promise<EditResult>;
}

export function colLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/** Хеш редактируемых полей: если он совпадает с сохранённым в строке — администратор ничего не менял */
export function editHash(values: string[]): string {
  return createHash("sha256").update(values.map((v) => v.trim()).join("\u0001")).digest("hex").slice(0, 16);
}

export function rowWithHash(spec: EntitySpec, cells: string[]): string[] {
  const padded = spec.headers.map((_, i) => cells[i] ?? "");
  return [...padded, editHash(spec.editable.map((i) => padded[i] ?? ""))];
}

export interface EngineReport {
  pulled: number; // правки администратора, принятые в БД
  rejected: number; // правки, которые отклонены и перезаписаны значением из БД
  updated: number;
  appended: number;
  writtenIds: string[];
}

/**
 * Один цикл для листа: 1) принять правки администратора (кроме строк, ожидающих
 * записи из БД — там БД главнее), 2) записать в таблицу изменённые/недостающие сущности.
 */
export async function syncEntity(io: SheetsIO, spec: EntitySpec, opts: { queuedIds: Set<string>; reconcile: boolean }): Promise<EngineReport> {
  const width = spec.headers.length + 1;
  const hashIdx = spec.headers.length;
  const rows = await io.read(spec.sheet, width);

  const index = new Map<string, number>();
  const dirty = new Set<string>(opts.queuedIds);
  const report: EngineReport = { pulled: 0, rejected: 0, updated: 0, appended: 0, writtenIds: [] };

  rows.forEach((cells, i) => {
    const id = (cells[0] ?? "").trim();
    if (id && !index.has(id)) index.set(id, i + 2);
  });

  // 1) Sheets → DB
  for (const [id, rowNumber] of index) {
    if (opts.queuedIds.has(id)) continue; // в очереди изменение из БД: БД главнее
    const cells = rows[rowNumber - 2] ?? [];
    const edited = spec.editable.map((c) => cells[c] ?? "");
    if ((cells[hashIdx] ?? "") === editHash(edited)) continue; // не менялось: петли нет
    const result = await spec.applyEdit(id, edited);
    if (result === "applied") report.pulled++;
    if (result === "rejected") report.rejected++;
    if (result !== "unknown") dirty.add(id); // перезаписать строку свежими данными и новым хешем
  }

  // 2) сверка: сущности из БД, которых нет в таблице
  if (opts.reconcile) {
    for (const id of await spec.loadRecentIds()) if (!index.has(id)) dirty.add(id);
  }

  // 3) DB → Sheets
  if (dirty.size) {
    const entities = await spec.load([...dirty]);
    const updates: { row: number; values: string[] }[] = [];
    const appends: string[][] = [];
    for (const e of entities) {
      const values = rowWithHash(spec, e.cells);
      const row = index.get(e.id);
      if (row) updates.push({ row, values });
      else appends.push(values);
      report.writtenIds.push(e.id);
    }
    if (updates.length) await io.update(spec.sheet, width, updates);
    if (appends.length) await io.append(spec.sheet, appends);
    report.updated = updates.length;
    report.appended = appends.length;
  }
  return report;
}
