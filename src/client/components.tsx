import { ArrowDownRight, ArrowUpRight, Clock3 } from "lucide-react";
import { Link } from "react-router-dom";
import type { ProductSummary, SnapshotSummary } from "../shared/contracts";

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
