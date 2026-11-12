import { ArrowDownRight, ArrowUpRight, Clock3 } from "lucide-react";
import { Link } from "react-router-dom";
import type { MicrosoftInvestment, ProductSummary, SnapshotSummary } from "../shared/contracts";
import { investmentView } from "../shared/investment";

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

export function MicrosoftInvestmentPanel({ investment, compact = false }: { investment?: MicrosoftInvestment; compact?: boolean }) {
  const view = investmentView(investment);
  const Title = compact ? "p" : "h2";
  return (
    <div className={compact ? "investment investment-compact" : "investment"} aria-label={view.title}>
      <Title className={compact ? "investment-title" : undefined}>{view.title}</Title>
      <p className="investment-note">{view.label}</p>
      <p>{view.windowLabel}</p>
      <p>{view.asOfLabel}</p>
      <p>Roadmap: <strong>{view.roadmap}</strong></p>
      {view.statuses.length > 0 && (
        <ul>
          {view.statuses.map((line) => (
            <li key={line.status}><span>{line.status}</span><strong>{line.value}</strong></li>
          ))}
        </ul>
      )}
      <p>Message Center: <strong>{view.messageCenter}</strong></p>
    </div>
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
      <MicrosoftInvestmentPanel investment={product.microsoftInvestment} compact />
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
