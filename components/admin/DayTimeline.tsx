import { DateTime } from "luxon";
import { env } from "@/lib/config/env";
import type { TimelineMaster } from "@/lib/admin/stats";
import { minutesToHHmm } from "@/lib/utils/time";

const H = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Лента дня: у каждого мастера полоса рабочих часов, перерывы и записи блоками */
export function DayTimeline({ masters }: { masters: TimelineMaster[] }) {
  const starts = masters.flatMap((m) => [m.window?.startMin, ...m.bookings.map((b) => b.startMin)]).filter((x): x is number => x !== undefined);
  const ends = masters.flatMap((m) => [m.window?.endMin, ...m.bookings.map((b) => b.endMin)]).filter((x): x is number => x !== undefined);
  const from = Math.floor((starts.length ? Math.min(...starts) : 9 * 60) / 60) * 60;
  const to = Math.ceil((ends.length ? Math.max(...ends) : 20 * 60) / 60) * 60;
  const span = Math.max(60, to - from);
  const pct = (m: number) => `${((m - from) / span) * 100}%`;
  const wid = (a: number, b: number) => `${((b - a) / span) * 100}%`;

  const now = DateTime.now().setZone(env().SALON_TIMEZONE);
  const nowMin = now.hour * 60 + now.minute;
  const hours: number[] = [];
  for (let m = from; m <= to; m += 60) hours.push(m);

  if (!masters.length) return <p className="tl-empty">Активных мастеров пока нет.</p>;

  return (
    <div className="tl-scroll">
      <div className="tl" style={{ ["--hour" as string]: `${(60 / span) * 100}%` }}>
        <div className="tl-axis" aria-hidden="true">
          {hours.map((m) => (
            <span key={m} style={{ left: pct(m) }}>
              {H(m)}
            </span>
          ))}
        </div>
        {masters.map((m) => (
          <div className="tl-row" key={m.id}>
            <div className="tl-name">
              {m.name}
              <small>{m.window ? `${minutesToHHmm(m.window.startMin)}–${minutesToHHmm(m.window.endMin)}` : "выходной"}</small>
            </div>
            <div className="tl-track">
              {m.window ? (
                <>
                  <div className="tl-work" style={{ left: pct(m.window.startMin), width: wid(m.window.startMin, m.window.endMin) }} />
                  {m.window.breaks.map((b, i) => (
                    <div key={i} className="tl-break" title="Перерыв" style={{ left: pct(b.startMin), width: wid(b.startMin, b.endMin) }} />
                  ))}
                </>
              ) : (
                <div className="tl-off">Не работает</div>
              )}
              {m.bookings.map((b) => (
                <div
                  key={b.id}
                  className={`tl-b${b.status === "COMPLETED" ? " done" : b.status === "NO_SHOW" ? " noshow" : ""}`}
                  style={{ left: pct(b.startMin), width: wid(b.startMin, b.endMin) }}
                  title={`${H(b.startMin)}–${H(b.endMin)} · ${b.label} · ${b.client}`}
                >
                  <b>{H(b.startMin)}</b>
                  {b.label}
                </div>
              ))}
              {nowMin >= from && nowMin <= to && <div className="tl-now" style={{ left: pct(nowMin) }} title="Сейчас" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
