import { describe, it, expect } from "vitest";
import { can } from "@/lib/admin/permissions";
import { columnCells, type DayBooking } from "@/lib/admin/calendar-cells";
import { parseHHmm, validateDay, validateException } from "@/lib/admin/schedule-form";
import { checkStaffChange } from "@/lib/admin/staff-rules";
import { httpsUrl, intField } from "@/lib/admin/forms";

const h = (x: number) => x * 60;

describe("permissions: schedule read vs write", () => {
  it("master can view but not edit the schedule; admin can edit", () => {
    expect(can("MASTER", "schedule")).toBe(true);
    expect(can("MASTER", "schedule:write")).toBe(false);
    expect(can("ADMIN", "schedule:write")).toBe(true);
  });
  it("only the owner reaches staff, logs, sheets, masters and data erasure", () => {
    for (const p of ["admins", "logs", "sheets", "masters"] as const) {
      expect(can("SUPER_ADMIN", p)).toBe(true);
      expect(can("ADMIN", p)).toBe(false);
      expect(can("MASTER", p)).toBe(false);
    }
  });
});

describe("schedule form validation", () => {
  const day = { weekday: 1, enabled: true, start: "09:00", end: "18:00", breakStart: "13:00", breakEnd: "14:00" };
  it("parses HH:mm strictly", () => {
    expect(parseHHmm("09:30")).toBe(570);
    expect(parseHHmm("24:00")).toBeNull();
    expect(parseHHmm("9:30")).toBeNull();
    expect(parseHHmm("")).toBeNull();
  });
  it("accepts a normal day and a day off", () => {
    expect(validateDay(day)).toEqual({ ok: true, row: { weekday: 1, startMin: h(9), endMin: h(18), breakStartMin: h(13), breakEndMin: h(14) } });
    expect(validateDay({ ...day, enabled: false })).toEqual({ ok: true, row: null });
    expect(validateDay({ ...day, breakStart: "", breakEnd: "" })).toMatchObject({ ok: true, row: { breakStartMin: null, breakEndMin: null } });
  });
  it("rejects bad ranges and breaks outside working hours", () => {
    expect(validateDay({ ...day, end: "09:10" })).toEqual({ ok: false, error: "range" });
    expect(validateDay({ ...day, start: "xx" })).toEqual({ ok: false, error: "time" });
    expect(validateDay({ ...day, breakStart: "08:00", breakEnd: "09:00" })).toEqual({ ok: false, error: "break" });
    expect(validateDay({ ...day, breakStart: "14:00", breakEnd: "13:00" })).toEqual({ ok: false, error: "break" });
    expect(validateDay({ ...day, breakEnd: "" })).toEqual({ ok: false, error: "break" });
  });
  it("exceptions", () => {
    expect(validateException("VACATION", "", "")).toEqual({ ok: true, startMin: null, endMin: null });
    expect(validateException("BREAK", "12:00", "12:30")).toEqual({ ok: true, startMin: h(12), endMin: h(12) + 30 });
    expect(validateException("CUSTOM_HOURS", "", "")).toEqual({ ok: false });
    expect(validateException("HACK", "", "")).toEqual({ ok: false });
  });
});

describe("staff safety rules", () => {
  const base = { actorId: "a", targetId: "b", targetRole: "ADMIN" as const, targetActive: true, activeSuperAdmins: 2 };
  it("blocks self-lockout and removing the last owner", () => {
    expect(checkStaffChange({ ...base, actorId: "o", targetId: "o", targetRole: "SUPER_ADMIN", newActive: false })).toBe("self");
    expect(checkStaffChange({ ...base, actorId: "o", targetId: "o", targetRole: "SUPER_ADMIN", newRole: "ADMIN" })).toBe("self");
    expect(checkStaffChange({ ...base, targetRole: "SUPER_ADMIN", newActive: false, activeSuperAdmins: 1 })).toBe("last_owner");
    expect(checkStaffChange({ ...base, targetRole: "SUPER_ADMIN", newRole: "MASTER", activeSuperAdmins: 1 })).toBe("last_owner");
  });
  it("allows ordinary changes", () => {
    expect(checkStaffChange({ ...base, newActive: false })).toBeNull();
    expect(checkStaffChange({ ...base, targetRole: "SUPER_ADMIN", newActive: false, activeSuperAdmins: 2 })).toBeNull();
    expect(checkStaffChange({ ...base, newRole: "MASTER" })).toBeNull();
  });
});

describe("calendar cells (🟢 free / 🔴 busy / 🟡 break / ⚫ off)", () => {
  const window = { startMin: h(9), endMin: h(12), breaks: [{ startMin: h(10), endMin: h(10) + 30 }] };
  const booking: DayBooking = { id: "b1", startMin: h(11), endMin: h(12), label: "Стрижка", client: "Мария", status: "CONFIRMED" };
  it("marks states per half-hour row", () => {
    const cells = columnCells(window, [booking], h(8), h(13));
    expect(cells.map((c) => c.state)).toEqual(["off", "off", "free", "free", "break", "free", "busy", "busy", "off", "off"]);
    expect(cells[6]?.first).toBe(true);
    expect(cells[7]?.first).toBe(false);
  });
  it("day off = all off", () => {
    expect(columnCells(null, [], h(9), h(11)).every((c) => c.state === "off")).toBe(true);
  });
});

describe("form helpers", () => {
  it("intField enforces integer ranges", () => {
    const fd = new FormData();
    fd.set("a", "42");
    fd.set("b", "4.5");
    fd.set("c", "999999999999");
    fd.set("d", "-1");
    expect(intField(fd, "a", 0, 100)).toBe(42);
    expect(intField(fd, "b", 0, 100)).toBeNull();
    expect(intField(fd, "c", 0, 1e12)).toBeNull();
    expect(intField(fd, "d", 0, 100)).toBeNull();
    expect(intField(fd, "missing", 0, 100)).toBeNull();
  });
  it("httpsUrl only accepts https", () => {
    expect(httpsUrl("https://cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
    expect(httpsUrl("http://cdn.example.com/a.jpg")).toBeNull();
    expect(httpsUrl("javascript:alert(1)")).toBeNull();
    expect(httpsUrl("")).toBeNull();
  });
});
