export function parseHHmm(v: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export interface DayInput {
  weekday: number;
  enabled: boolean;
  start: string;
  end: string;
  breakStart: string;
  breakEnd: string;
}

export interface DayRow {
  weekday: number;
  startMin: number;
  endMin: number;
  breakStartMin: number | null;
  breakEndMin: number | null;
}

export type DayResult = { ok: true; row: DayRow | null } | { ok: false; error: string };

export function validateDay(d: DayInput): DayResult {
  if (!d.enabled) return { ok: true, row: null }; // выходной
  const start = parseHHmm(d.start);
  const end = parseHHmm(d.end);
  if (start === null || end === null) return { ok: false, error: "time" };
  if (end - start < 30) return { ok: false, error: "range" };
  const hasBreak = d.breakStart !== "" || d.breakEnd !== "";
  let bs: number | null = null;
  let be: number | null = null;
  if (hasBreak) {
    bs = parseHHmm(d.breakStart);
    be = parseHHmm(d.breakEnd);
    if (bs === null || be === null) return { ok: false, error: "break" };
    if (!(bs < be && bs >= start && be <= end)) return { ok: false, error: "break" };
  }
  return { ok: true, row: { weekday: d.weekday, startMin: start, endMin: end, breakStartMin: bs, breakEndMin: be } };
}

export type ExceptionType = "DAY_OFF" | "VACATION" | "BREAK" | "CUSTOM_HOURS";

export function validateException(type: string, start: string, end: string): { ok: true; startMin: number | null; endMin: number | null } | { ok: false } {
  if (type === "DAY_OFF" || type === "VACATION") return { ok: true, startMin: null, endMin: null };
  if (type === "BREAK" || type === "CUSTOM_HOURS") {
    const s = parseHHmm(start);
    const e = parseHHmm(end);
    return s !== null && e !== null && e - s >= 15 ? { ok: true, startMin: s, endMin: e } : { ok: false };
  }
  return { ok: false };
}
