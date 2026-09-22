import type { BookingStatus } from "@prisma/client";

const LIVE: BookingStatus[] = ["NEW", "CONFIRMED"];

/**
 * Допустимые смены статуса вручную (админка / Google Sheets).
 * Из «живой» записи — в подтверждённую, отменённую, завершённую, «не пришёл».
 * Обратно из финальных статусов нельзя: слот мог быть занят другим клиентом.
 * «Перенесена» выставляет только система при переносе.
 */
export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  if (from === to) return false;
  if (!LIVE.includes(from)) return false;
  if (from === "CONFIRMED" && to === "NEW") return false;
  return ["CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"].includes(to);
}
