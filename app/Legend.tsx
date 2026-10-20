// Met Éireann's rainfall-rate scale (mm/hr), the same one met.ie shows for both
// its radar and its forecast rain maps. Colours sampled from met.ie's legend
// image (radar-map-legend2.png); each band runs from `from` up to the next.
const BANDS: Array<{ from: number; color: string }> = [
  { from: 0.1, color: "#8bbaff" },
  { from: 0.3, color: "#38a0ff" },
  { from: 0.5, color: "#008bc5" },
  { from: 0.7, color: "#0076bf" },
  { from: 1, color: "#00a351" },
  { from: 2, color: "#21cb00" },
  { from: 3, color: "#ffff00" },
  { from: 6, color: "#ff9900" },
  { from: 12, color: "#ff0000" },
  { from: 20, color: "#800000" },
  { from: 32, color: "#840084" },
];

const DESCRIPTION =
  "Rain rate in millimetres per hour: blues from 0.1 to 1, greens from 1 to 3, " +
  "yellow from 3, orange from 6, red from 12, dark red from 20 and purple from 32.";

/**
 * A colour key for the rain layers. Desktop: vertical on the right, heaviest
 * at the top. Phones: horizontal along the top, lightest on the left, taking
 * turns with the attribution (`hidden` while that's open). Each value sits on
 * the boundary where its band starts.
 */
export function Legend({ hidden = false }: { hidden?: boolean }) {
  return (
    <div className={hidden ? "legend legend-hidden" : "legend"} role="img" aria-label={DESCRIPTION}>
      <div className="legend-title">mm/hr</div>
      <ol className="legend-scale">
        {[...BANDS].reverse().map((b) => (
          <li key={b.from} style={{ "--band": b.color } as React.CSSProperties}>
            <span className="legend-value">{b.from}</span>
            <span className="legend-swatch" />
          </li>
        ))}
      </ol>
    </div>
  );
}
