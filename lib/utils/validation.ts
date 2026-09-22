/** Возвращает телефон в формате +7XXXXXXXXXX (или общий E.164) либо null */
export function normalizePhone(input: string): string | null {
  const raw = input.trim();
  if (raw.length > 30) return null;
  const digits = raw.replace(/\D/g, "");
  if (/^[78]\d{10}$/.test(digits)) return `+7${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `+7${digits}`;
  if (raw.startsWith("+") && !raw.startsWith("+7") && /^\d{10,15}$/.test(digits)) return `+${digits}`;
  return null;
}

export function validateName(input: string): string | null {
  const name = input.trim().replace(/\s+/g, " ");
  return /^[\p{L}][\p{L}\s'’.-]{1,49}$/u.test(name) ? name : null;
}
