// Чистая логика расчёта слотов (без БД) — легко тестируется.
export interface Interval {
  startMin: number;
  endMin: number;
}

export interface WeeklyRow {
  startMin: number;
  endMin: number;
  breakStartMin?: number | null;
  breakEndMin?: number | null;
}

export interface ExceptionRow {
  type: "DAY_OFF" | "VACATION" | "BREAK" | "CUSTOM_HOURS";
  startMin?: number | null;
  endMin?: number | null;
}

export interface DayWindow extends Interval {
  breaks: Interval[];
}

/** Рабочее окно дня с учётом недельного графика и исключений; null — мастер не работает */
export function resolveDayWindow(weekly: WeeklyRow | null, exceptions: ExceptionRow[]): DayWindow | null {
  if (!weekly) return null;
  if (exceptions.some((e) => e.type === "DAY_OFF" || e.type === "VACATION")) return null;

  let startMin = weekly.startMin;
  let endMin = weekly.endMin;
  const breaks: Interval[] = [];
  if (weekly.breakStartMin != null && weekly.breakEndMin != null) {
    breaks.push({ startMin: weekly.breakStartMin, endMin: weekly.breakEndMin });
  }
  for (const e of exceptions) {
    if (e.type === "CUSTOM_HOURS" && e.startMin != null && e.endMin != null) {
      startMin = e.startMin;
      endMin = e.endMin;
    }
    if (e.type === "BREAK" && e.startMin != null && e.endMin != null) {
      breaks.push({ startMin: e.startMin, endMin: e.endMin });
    }
  }
  return endMin > startMin ? { startMin, endMin, breaks } : null;
}

export interface SlotInput {
  startMin: number;
  endMin: number;
  busy: Interval[];
  durationMin: number;
  stepMin?: number;
  /** самое раннее допустимое начало (минуты от полуночи), например «сейчас + 60 мин» */
  earliestMin?: number;
}

export function computeSlotMinutes(i: SlotInput): number[] {
  const step = i.stepMin ?? 30;
  const out: number[] = [];
  for (let s = i.startMin; s + i.durationMin <= i.endMin; s += step) {
    if (i.earliestMin !== undefined && s < i.earliestMin) continue;
    const e = s + i.durationMin;
    if (i.busy.some((b) => s < b.endMin && e > b.startMin)) continue;
    out.push(s);
  }
  return out;
}
