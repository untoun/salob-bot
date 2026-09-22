import { describe, it, expect } from "vitest";
import { guardReply, scrubUserText } from "@/lib/openai/guard";

describe("scrubUserText", () => {
  it("removes phones and emails before sending to OpenAI", () => {
    const t = scrubUserText("Меня зовут Мария, тел +7 (912) 345-67-89, почта maria@example.com, хочу стрижку");
    expect(t).not.toMatch(/912|345|67-89/);
    expect(t).not.toContain("@");
    expect(t).toContain("[номер]");
    expect(t).toContain("[email]");
    expect(t).toContain("хочу стрижку");
  });
  it("keeps budget ranges", () => {
    expect(scrubUserText("бюджет 2 500 - 3 000 рублей")).toContain("2 500 - 3 000");
  });
  it("truncates long input", () => {
    expect(scrubUserText("а".repeat(2000)).length).toBe(500);
  });
});

describe("guardReply", () => {
  const prices = [1500, 1000, 3500];
  it("passes a clean reply", () => {
    expect(guardReply("Для вашей длины подойдёт стрижка. Хотите добавить уход?", prices).ok).toBe(true);
  });
  it("allows known prices, blocks invented ones", () => {
    expect(guardReply("Стрижка стоит 1 500 ₽", prices).ok).toBe(true);
    expect(guardReply("Окрашивание от 3500 руб", prices).ok).toBe(true);
    expect(guardReply("Стрижка стоит 900 ₽", prices)).toEqual({ ok: false, reason: "price" });
  });
  it("blocks invented times, slots and booking claims", () => {
    expect(guardReply("Есть время завтра в 15:00", prices)).toEqual({ ok: false, reason: "time" });
    expect(guardReply("Свободное время есть на этой неделе", prices)).toEqual({ ok: false, reason: "slots" });
    expect(guardReply("Отлично, я записала вас!", prices)).toEqual({ ok: false, reason: "booking_claim" });
    expect(guardReply("Ваша запись подтверждена", prices)).toEqual({ ok: false, reason: "booking_claim" });
  });
});
