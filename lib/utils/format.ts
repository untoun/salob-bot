export function formatPrice(priceRub: number, from = false): string {
  const n = priceRub.toLocaleString("ru-RU").replace(/[\u00a0\u202f]/g, " ");
  return `${from ? "от " : ""}${n} ₽`;
}

export function formatDuration(min: number): string {
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}
