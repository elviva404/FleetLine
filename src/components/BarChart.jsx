import { useState } from "react";

// Single-series bar chart drawn as plain SVG: no library, works offline,
// and scales to the width of the card. Tap or hover a bar for its value.
export default function BarChart({ data, format = (v) => v, height = 140, label = "Chart" }) {
  const [active, setActive] = useState(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const width = 320;
  const gap = 3;
  const barWidth = data.length ? (width - gap * (data.length - 1)) / data.length : width;
  const baseline = height - 18;

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chart-svg"
        role="img"
        aria-label={label}
        preserveAspectRatio="none"
        onPointerLeave={() => setActive(null)}
      >
        <line x1="0" y1={baseline} x2={width} y2={baseline} className="chart-axis" />
        {data.map((d, i) => {
          const barHeight = d.value > 0 ? Math.max(2, (d.value / max) * (baseline - 6)) : 0;
          const x = i * (barWidth + gap);
          return (
            <g key={d.label} onPointerEnter={() => setActive(i)} onPointerDown={() => setActive(i)}>
              {/* Invisible full-height target so small bars are still easy to tap */}
              <rect x={x} y="0" width={barWidth} height={baseline} fill="transparent" />
              <rect
                x={x}
                y={baseline - barHeight}
                width={barWidth}
                height={barHeight}
                rx="3"
                className={`chart-bar${active === i ? " chart-bar-active" : ""}`}
              />
            </g>
          );
        })}
      </svg>
      <div className="chart-labels" aria-hidden="true">
        {data.map((d, i) => (
          <span key={d.label} className={active === i ? "chart-label-active" : ""}>
            {d.short ?? d.label}
          </span>
        ))}
      </div>
      <figcaption className="chart-caption">
        {active == null
          ? `Tap a bar to see the amount. Highest: ${format(max)}.`
          : `${data[active].label}: ${format(data[active].value)}`}
      </figcaption>
      <table className="visually-hidden">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.label}</th>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
