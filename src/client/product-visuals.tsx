import { ExternalLink } from "lucide-react";
import { formatDate } from "./api";
import { EmptyState } from "./components";

export function TrendChart({ data }: { data: Array<{ analyzedAt: string; barometerScore: number }> }) {
  if (data.length < 2) return <EmptyState message="Trend data appears after the second automated analysis." />;
  const width = 720;
  const height = 220;
  const points = data.map((point, index) => {
    const x = 20 + (index / (data.length - 1)) * (width - 40);
    const y = height - 20 - (point.barometerScore / 100) * (height - 40);
    return `${x},${y}`;
  }).join(" ");
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Historical barometer score">
        {[25, 50, 75].map((value) => {
          const y = height - 20 - (value / 100) * (height - 40);
          return <line key={value} x1="20" x2={width - 20} y1={y} y2={y} className="chart-grid" />;
        })}
        <polyline points={points} className="chart-line" />
        {data.map((point, index) => {
          const [x, y] = points.split(" ")[index].split(",");
          return <circle key={point.analyzedAt} cx={x} cy={y} r="4" className="chart-point" />;
        })}
      </svg>
      <div className="chart-labels"><span>{formatDate(data[0].analyzedAt)}</span><span>{formatDate(data.at(-1)!.analyzedAt)}</span></div>
    </div>
  );
}

export function MentionList({ mentions }: { mentions: Array<Record<string, unknown>> }) {
  return (
    <div className="mention-list">
      {mentions.map((mention, index) => (
        <article className="mention" key={`${String(mention.sourceUrl)}-${index}`}>
          <div className="mention-head">
            <span className={`sentiment sentiment-${String(mention.sentiment)}`}>{String(mention.sentiment)}</span>
            <span>{String(mention.sourceType)}</span>
            {Boolean(mention.sourceUrl) && (
              <a href={String(mention.sourceUrl)} target="_blank" rel="noreferrer" aria-label="Open source">
                <ExternalLink size={15} />
              </a>
            )}
          </div>
          <h3>{String(mention.sourceTitle)}</h3>
          <p>{String(mention.excerpt)}</p>
        </article>
      ))}
    </div>
  );
}
