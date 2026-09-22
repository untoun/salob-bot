const TEXT: Record<string, { cls: string; text: string }> = {
  saved: { cls: "ok", text: "Изменения сохранены." },
  deleted: { cls: "ok", text: "Удалено." },
  invalid: { cls: "err", text: "Проверьте поля формы: часть значений некорректна." },
  notfound: { cls: "err", text: "Запись не найдена." },
  error: { cls: "err", text: "Не удалось сохранить. Попробуйте ещё раз." },
};

export function Notice({ code, extra }: { code: unknown; extra?: Record<string, { cls: string; text: string }> }) {
  if (typeof code !== "string") return null;
  const n = extra?.[code] ?? TEXT[code];
  if (!n) return null;
  return (
    <div className={`notice ${n.cls}`} role="status">
      {n.text}
    </div>
  );
}
