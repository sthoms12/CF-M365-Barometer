import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { ProductSummary } from "../../shared/contracts";
import { api, formatDate } from "../api";
import { EmptyState, MentionList, Momentum, Score, TemperatureBadge, TrendChart } from "../components";

type Detail = { product: ProductSummary; mentions: Array<Record<string, unknown>> };

export function ProductPage() {
  const { slug } = useParams();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [history, setHistory] = useState<Array<{ analyzedAt: string; barometerScore: number }>>([]);
  useEffect(() => {
    api<Detail>(`/api/products/${slug}`).then(setDetail);
    api<{ history: Array<{ analyzedAt: string; barometerScore: number }> }>(`/api/products/${slug}/history`).then((data) => setHistory(data.history));
  }, [slug]);

  if (!detail) return <main className="page-shell"><EmptyState message="Loading product reading..." /></main>;
  const { product, mentions } = detail;
  const snapshot = product.snapshot;
  return (
    <main className="page-shell">
      <section className="product-hero">
        <div>
          <p className="eyebrow">Microsoft 365 community barometer</p>
          <h1>{product.name}</h1>
          <p>{product.description}</p>
          <span className="last-analyzed">Last analyzed: {formatDate(product.lastAnalyzedAt)}{product.isStale ? " · stale" : ""}</span>
        </div>
        {snapshot ? <Score value={snapshot.barometerScore} size="large" /> : <span className="no-score">Pending first reading</span>}
      </section>
      {!snapshot ? <EmptyState message="The first automated Last30Days analysis is scheduled. No manual import is required." /> : (
        <>
          <section className="metric-strip">
            <div><span>Temperature</span><TemperatureBadge value={snapshot.temperature} /></div>
            <div><span>Momentum</span><Momentum value={snapshot.momentum} /></div>
            <div><span>Confidence</span><strong>{snapshot.confidence}</strong></div>
            <div><span>Discussion volume</span><strong>{snapshot.discussionVolume}</strong></div>
          </section>
          <section className="detail-band summary-band">
            <div><p className="eyebrow">Current reading</p><h2>What the community signal says</h2></div>
            <p className="summary-copy">{snapshot.summary}</p>
          </section>
          <section className="signal-columns">
            <div><h2>Positive signals</h2><ul>{snapshot.positiveSignals.map((signal) => <li key={signal}>{signal}</li>)}</ul></div>
            <div><h2>Negative signals</h2><ul>{snapshot.negativeSignals.map((signal) => <li key={signal}>{signal}</li>)}</ul></div>
          </section>
          <section className="detail-band"><h2>Historical trend</h2><TrendChart data={history} /></section>
          <section className="detail-band">
            <h2>Source breakdown</h2>
            <div className="source-bars">
              {Object.entries(snapshot.sourceBreakdown).map(([source, count]) => (
                <div key={source}><span>{source}</span><div><i style={{ width: `${Math.min(100, count * 5)}%` }} /></div><strong>{count}</strong></div>
              ))}
            </div>
          </section>
          <section className="detail-band"><h2>Sample public mentions</h2><MentionList mentions={mentions} /></section>
        </>
      )}
    </main>
  );
}
