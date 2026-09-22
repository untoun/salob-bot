/** Столбчатая диаграмма на inline-SVG: без клиентского JS и сторонних библиотек */
export function BarChart({ data, unit = "" }: { data: { label: string; value: number; highlight?: boolean }[]; unit?: string }) {
  const W = 560;
  const H = 170;
  const padTop = 20;
  const padBottom = 24;
  const max = Math.max(1, ...data.map((d) => d.value));
  const slot = W / Math.max(1, data.length);
  const bw = Math.min(28, slot * 0.6);
  const label = data.map((d) => `${d.label}: ${d.value}${unit}`).join(", ");

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {data.map((d, i) => {
          const h = ((H - padTop - padBottom) * d.value) / max;
          const x = i * slot + (slot - bw) / 2;
          const y = H - padBottom - h;
          return (
            <g key={d.label}>
              <rect className={`bar${d.highlight ? " today" : ""}`} x={x} y={y} width={bw} height={Math.max(h, d.value > 0 ? 2 : 0)} rx={3} />
              {d.value > 0 && (
                <text className="v" x={x + bw / 2} y={y - 5} textAnchor="middle">
                  {d.value}
                </text>
              )}
              <text x={x + bw / 2} y={H - 8} textAnchor="middle">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
