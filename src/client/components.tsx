import { ArrowDownRight, ArrowUpRight, Clock3, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import type { ProductSummary, SnapshotSummary } from "../shared/contracts";
import { formatDate } from "./api";

export function Score({ value, size = "normal" }: { value: number; size?: "normal" | "large" }) {
  const tone = value >= 65 ? "positive" : value <= 35 ? "negative" : "neutral";
  return (
    <div className={`score score-${size} score-${tone}`} aria-label={`Barometer score ${value}`}>
      <span>{value}</span>
      <small>/100</small>
    </div>
  );
}

export function TemperatureBadge({ value }: { value: SnapshotSummary["temperature"] }) {
  return <span className={`temperature temperature-${value.toLowerCase()}`}>{value}</span>;
}

export function Momentum({ value }: { value: number }) {
  if (value === 0) return <span className="momentum momentum-flat">0</span>;
  return (
    <span className={`momentum ${value > 0 ? "momentum-up" : "momentum-down"}`}>
      {value > 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
      {value > 0 ? "+" : ""}{value}
    </span>
  );
}

export function ProductCard({ product }: { product: ProductSummary }) {
  return (
    <Link className="product-card" to={`/products/${product.slug}`}>
      <div className="product-card-main">
        <div>
          <h3>{product.name}</h3>
          <p>{product.description}</p>
        </div>
        {product.snapshot ? <Score value={product.snapshot.barometerScore} /> : <span className="no-score">Pending</span>}
      </div>
      <div className="product-card-meta">
        {product.snapshot ? (
          <>
            <TemperatureBadge value={product.snapshot.temperature} />
            <Momentum value={product.snapshot.momentum} />
            <span>{product.snapshot.discussionVolume} volume</span>
          </>
        ) : <span>Awaiting first automated analysis</span>}
        {product.isStale && <span className="stale"><Clock3 size={13} /> Stale</span>}
      </div>
    </Link>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <div className="empty-state"><Clock3 size={24} /><p>{message}</p></div>;
}

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
