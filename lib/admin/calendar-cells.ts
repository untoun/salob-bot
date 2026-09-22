// Чистая логика ячеек календаря (без БД) — тестируется отдельно.
import type { DayWindow } from "@/lib/booking/slots";

export type CellState = "free" | "busy" | "break" | "off";

export interface DayBooking {
  id: string;
  startMin: number;
  endMin: number;
  label: string;
  client: string;
  status: string;
}

export interface Cell {
  state: CellState;
  booking?: DayBooking;
  first?: boolean; // первая строка блока записи
}

/** Состояние каждой строки (шаг rowStep минут) для одной колонки календаря */
export function columnCells(window: DayWindow | null, bookings: DayBooking[], from: number, to: number, rowStep = 30): Cell[] {
  const cells: Cell[] = [];
  for (let t = from; t < to; t += rowStep) {
    const end = t + rowStep;
    if (!window || t < window.startMin || t >= window.endMin) {
      cells.push({ state: "off" });
      continue;
    }
    const b = bookings.find((x) => x.startMin < end && x.endMin > t);
    if (b) {
      cells.push({ state: "busy", booking: b, first: b.startMin >= t && b.startMin < end });
      continue;
    }
    cells.push({ state: window.breaks.some((x) => t < x.endMin && end > x.startMin) ? "break" : "free" });
  }
  return cells;
}
