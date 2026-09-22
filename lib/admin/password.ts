export const MIN_PASSWORD = 12;

export function validatePassword(pw: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Пароль должен быть не короче ${MIN_PASSWORD} символов.`;
  if (pw.length > 128) return "Пароль слишком длинный (максимум 128 символов).";
  if (/^(.)\1+$/.test(pw)) return "Пароль не должен состоять из одного повторяющегося символа.";
  return null;
}

export function normalizeEmail(input: string): string | null {
  const e = input.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}
