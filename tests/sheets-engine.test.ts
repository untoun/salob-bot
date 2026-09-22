import { describe, it, expect, beforeEach } from "vitest";
import { colLetter, editHash, syncEntity, type EditResult, type EntitySpec, type SheetsIO } from "@/lib/google/engine";

/** Фейковая таблица в памяти */
class FakeSheets implements SheetsIO {
  rows: string[][] = [];
  async ensure() {}
  async read(_s: string, width: number) {
    return this.rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
  }
  async update(_s: string, _w: number, updates: { row: number; values: string[] }[]) {
    for (const u of updates) this.rows[u.row - 2] = u.values;
  }
  async append(_s: string, rows: string[][]) {
    this.rows.push(...rows);
  }
  async replace() {}
}

/** Фейковая БД: сущности {id, status, comment} */
function makeSpec(db: Map<string, { status: string; comment: string }>, log: string[]): EntitySpec {
  return {
    entityType: "booking",
    sheet: "Записи",
    headers: ["ID", "Клиент", "Статус", "Комментарий"],
    editable: [2, 3],
    async load(ids) {
      return ids.filter((i) => db.has(i)).map((id) => ({ id, cells: [id, "Мария", db.get(id)!.status, db.get(id)!.comment] }));
    },
    async loadRecentIds() {
      return [...db.keys()];
    },
    async applyEdit(id, [status = "", comment = ""]): Promise<EditResult> {
      const cur = db.get(id);
      if (!cur) return "unknown";
      log.push(`edit:${id}:${status}:${comment}`);
      if (!["Подтверждена", "Отменена"].includes(status)) return "rejected";
      if (cur.status === status && cur.comment === comment) return "noop";
      db.set(id, { status, comment });
      return "applied";
    },
  };
}

describe("sheets sync engine", () => {
  let io: FakeSheets;
  let db: Map<string, { status: string; comment: string }>;
  let log: string[];
  let spec: EntitySpec;

  beforeEach(() => {
    io = new FakeSheets();
    db = new Map([["b1", { status: "Подтверждена", comment: "" }]]);
    log = [];
    spec = makeSpec(db, log);
  });

  it("writes missing entities on reconcile and appends a hash", async () => {
    const r = await syncEntity(io, spec, { queuedIds: new Set(), reconcile: true });
    expect(r.appended).toBe(1);
    expect(io.rows[0]?.[0]).toBe("b1");
    expect(io.rows[0]?.[4]).toBe(editHash(["Подтверждена", ""]));
  });

  it("does NOT loop: a second pass after our own write pulls nothing", async () => {
    await syncEntity(io, spec, { queuedIds: new Set(["b1"]), reconcile: false });
    const again = await syncEntity(io, spec, { queuedIds: new Set(), reconcile: false });
    expect(log).toEqual([]); // applyEdit не вызывался
    expect(again.pulled).toBe(0);
    expect(again.updated + again.appended).toBe(0);
  });

  it("applies an admin edit exactly once and refreshes the hash", async () => {
    await syncEntity(io, spec, { queuedIds: new Set(["b1"]), reconcile: false });
    io.rows[0]![2] = "Отменена"; // администратор поменял статус
    io.rows[0]![3] = "звонила";
    const r1 = await syncEntity(io, spec, { queuedIds: new Set(), reconcile: false });
    expect(r1.pulled).toBe(1);
    expect(db.get("b1")).toEqual({ status: "Отменена", comment: "звонила" });
    expect(io.rows[0]?.[4]).toBe(editHash(["Отменена", "звонила"]));
    const r2 = await syncEntity(io, spec, { queuedIds: new Set(), reconcile: false });
    expect(r2.pulled).toBe(0);
    expect(log).toHaveLength(1);
  });

  it("rejected edit is overwritten with the DB value", async () => {
    await syncEntity(io, spec, { queuedIds: new Set(["b1"]), reconcile: false });
    io.rows[0]![2] = "Абракадабра";
    const r = await syncEntity(io, spec, { queuedIds: new Set(), reconcile: false });
    expect(r.rejected).toBe(1);
    expect(io.rows[0]?.[2]).toBe("Подтверждена");
  });

  it("DB wins when the row is queued: admin edit is not applied", async () => {
    await syncEntity(io, spec, { queuedIds: new Set(["b1"]), reconcile: false });
    io.rows[0]![3] = "правка админа";
    db.set("b1", { status: "Отменена", comment: "" }); // параллельно изменилось в БД (бот)
    await syncEntity(io, spec, { queuedIds: new Set(["b1"]), reconcile: false });
    expect(log).toEqual([]);
    expect(io.rows[0]?.[2]).toBe("Отменена");
    expect(io.rows[0]?.[3]).toBe("");
  });

  it("finds rows by ID even if the admin sorted/moved them", async () => {
    db.set("b2", { status: "Подтверждена", comment: "" });
    await syncEntity(io, spec, { queuedIds: new Set(["b1", "b2"]), reconcile: false });
    io.rows.reverse(); // сортировка
    db.set("b1", { status: "Отменена", comment: "" });
    await syncEntity(io, spec, { queuedIds: new Set(["b1"]), reconcile: false });
    const row = io.rows.find((r) => r[0] === "b1");
    expect(row?.[2]).toBe("Отменена");
    expect(io.rows.find((r) => r[0] === "b2")?.[2]).toBe("Подтверждена");
    expect(io.rows).toHaveLength(2); // дублей нет
  });
});

describe("helpers", () => {
  it("colLetter", () => {
    expect([1, 2, 26, 27, 52].map(colLetter)).toEqual(["A", "B", "Z", "AA", "AZ"]);
  });
  it("editHash ignores surrounding whitespace only", () => {
    expect(editHash([" a ", "b"])).toBe(editHash(["a", "b"]));
    expect(editHash(["a", "b"])).not.toBe(editHash(["a", "c"]));
  });
});
