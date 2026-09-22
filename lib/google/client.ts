import { google, type sheets_v4 } from "googleapis";
import { env, googlePrivateKey } from "@/lib/config/env";
import { colLetter, type SheetDef, type SheetsIO } from "./engine";

export function isGoogleConfigured(): boolean {
  const e = env();
  return Boolean(e.GOOGLE_SERVICE_ACCOUNT_EMAIL && googlePrivateKey() && e.GOOGLE_SHEET_ID);
}

function api(): sheets_v4.Sheets {
  const auth = new google.auth.JWT({
    email: env().GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: googlePrivateKey(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const code = Number((e as { code?: number | string }).code);
      if (!(code === 429 || code >= 500) || i === attempts) break;
      await new Promise((r) => setTimeout(r, 800 * 2 ** (i - 1)));
    }
  }
  throw last;
}

const q = (name: string) => `'${name.replace(/'/g, "''")}'`;

export function createSheetsIO(): SheetsIO {
  const sheets = api();
  const spreadsheetId = env().GOOGLE_SHEET_ID!;

  return {
    async ensure(defs: SheetDef[]) {
      const meta = await withRetry(() => sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title)" }));
      const existing = new Map((meta.data.sheets ?? []).map((s) => [s.properties?.title ?? "", s.properties?.sheetId ?? 0]));
      const created = new Set<string>();

      const missing = defs.filter((d) => !existing.has(d.name));
      if (missing.length) {
        const res = await withRetry(() =>
          sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: missing.map((d) => ({ addSheet: { properties: { title: d.name } } })) } }),
        );
        (res.data.replies ?? []).forEach((r, i) => {
          const def = missing[i];
          const id = r.addSheet?.properties?.sheetId;
          if (def && id !== undefined && id !== null) {
            existing.set(def.name, id);
            created.add(def.name);
          }
        });
      }

      // заголовки
      const headerRes = await withRetry(() =>
        sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: defs.map((d) => `${q(d.name)}!1:1`) }),
      );
      const toWrite: sheets_v4.Schema$ValueRange[] = [];
      defs.forEach((d, i) => {
        const wanted = d.hashColumn ? [...d.headers, "_hash"] : d.headers;
        const have = headerRes.data.valueRanges?.[i]?.values?.[0] ?? [];
        if (wanted.length !== have.length || wanted.some((h, k) => h !== have[k])) {
          toWrite.push({ range: `${q(d.name)}!A1:${colLetter(wanted.length)}1`, values: [wanted] });
        }
      });
      if (toWrite.length) {
        await withRetry(() => sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: toWrite } }));
      }

      // оформление — только для новых листов
      const requests: sheets_v4.Schema$Request[] = [];
      for (const d of defs) {
        if (!created.has(d.name)) continue;
        const sheetId = existing.get(d.name)!;
        const width = d.hashColumn ? d.headers.length + 1 : d.headers.length;
        requests.push(
          { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
          { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: "userEnteredFormat.textFormat.bold" } },
        );
        if (d.hashColumn) {
          requests.push({
            updateDimensionProperties: {
              range: { sheetId, dimension: "COLUMNS", startIndex: width - 1, endIndex: width },
              properties: { hiddenByUser: true },
              fields: "hiddenByUser",
            },
          });
        }
        if (d.statusColumn) {
          requests.push({
            setDataValidation: {
              range: { sheetId, startRowIndex: 1, endRowIndex: 5000, startColumnIndex: d.statusColumn.index, endColumnIndex: d.statusColumn.index + 1 },
              rule: { condition: { type: "ONE_OF_LIST", values: d.statusColumn.options.map((v) => ({ userEnteredValue: v })) }, showCustomUi: true, strict: true },
            },
          });
        }
      }
      if (requests.length) await withRetry(() => sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }));
    },

    async read(sheet, width) {
      const res = await withRetry(() =>
        sheets.spreadsheets.values.get({ spreadsheetId, range: `${q(sheet)}!A2:${colLetter(width)}`, valueRenderOption: "FORMATTED_VALUE" }),
      );
      return (res.data.values ?? []).map((r) => Array.from({ length: width }, (_, i) => String(r[i] ?? "")));
    },

    async update(sheet, width, updates) {
      await withRetry(() =>
        sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: "RAW", // RAW: значения вида "=..." не превращаются в формулы
            data: updates.map((u) => ({ range: `${q(sheet)}!A${u.row}:${colLetter(width)}${u.row}`, values: [u.values] })),
          },
        }),
      );
    },

    async append(sheet, rows) {
      await withRetry(() =>
        sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${q(sheet)}!A1`,
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: rows },
        }),
      );
    },

    async replace(sheet, width, rows) {
      await withRetry(() => sheets.spreadsheets.values.clear({ spreadsheetId, range: `${q(sheet)}!A2:${colLetter(width)}` }));
      if (rows.length) {
        await withRetry(() =>
          sheets.spreadsheets.values.update({ spreadsheetId, range: `${q(sheet)}!A2`, valueInputOption: "RAW", requestBody: { values: rows } }),
        );
      }
    },
  };
}

/** Проверка доступа к таблице (без чтения данных) */
export async function pingGoogle(): Promise<void> {
  const sheets = api();
  await withRetry(() => sheets.spreadsheets.get({ spreadsheetId: env().GOOGLE_SHEET_ID!, fields: "spreadsheetId" }), 2);
}
