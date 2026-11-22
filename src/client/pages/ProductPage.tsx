import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ProductSummary, SupplyDemandScore } from "../../shared/contracts";
import { api, formatDate } from "../api";
import { readProductBootstrap } from "../bootstrap";
import { EmptyState, MicrosoftInvestmentPanel, Momentum, Score, TemperatureBadge } from "../components";
import { MentionList, TrendChart } from "../product-visuals";

type Detail = { product: ProductSummary; mentions: Array<Record<string, unknown>> };

function withEstimate(text: string, estimated: boolean): string {
  return estimated ? `${text} (estimate)` : text;
}

function SupplyDemand({ score }: { score: SupplyDemandScore | undefined }) {
  if (!score || (score.status === "not_enough_data" && !score.supply && !score.demand)) {
    return <section className="detail-band"><h2>Supply vs demand</h2><p>Not enough data</p></section>;
  }
  const gap = score.gap === null ? "Not enough data" : withEstimate(score.gap > 0 ? `+${score.gap}` : String(score.gap), score.estimated);
  return (
    <section className="detail-band">
      <h2>Supply vs demand</h2>
      {score.week ? <p>Week of {score.week}</p> : null}
      <p>Supply: {score.supply ? withEstimate(String(score.supply.index), score.supply.estimated) : "Not enough data"}</p>
      <p>Demand: {score.demand ? withEstimate(String(score.demand.index), score.demand.estimated) : "Not enough data"}</p>
      <p>Supply vs demand: {gap}</p>
      <p>{score.label ? withEstimate(score.label, score.estimated) : "Not enough data"}</p>
      <p>Confidence: {score.confidence}</p>
    </section>
  );
}

export function ProductPage() {
  const { slug } = useParams();
  const initial = readProductBootstrap();
  const matched = initial && initial.product.slug === slug ? initial : null;
  const [detail, setDetail] = useState<Detail | null>(matched ? { product: matched.product, mentions: matched.mentions } : null);
  const [history, setHistory] = useState<Array<{ analyzedAt: string; barometerScore: number }>>(matched?.history ?? []);
  const [loading, setLoading] = useState<boolean>(!matched);
  const [error, setError] = useState<string>("");

  const loadProduct = useCallback((currentSlug: string | undefined, signal?: AbortSignal) => {
    if (!currentSlug) {
      setError("Product not found.");
      setLoading(false);
      return;
    }
    const next = readProductBootstrap();
    const hasBootstrapMatch = Boolean(next && next.product.slug === currentSlug);
    if (!hasBootstrapMatch) {
      setDetail(null);
      setHistory([]);
      setLoading(true);
    }
    setError("");
    Promise.all([
      api<Detail>(`/api/products/${encodeURIComponent(currentSlug)}`, { signal }),
      api<{ history: Array<{ analyzedAt: string; barometerScore: number }> }>(
        `/api/products/${encodeURIComponent(currentSlug)}/history`,
        { signal },
      ),
    ])
      .then(([detailData, historyData]) => {
        if (signal?.aborted) return;
        setDetail(detailData);
        setHistory(historyData.history);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
        setError(err instanceof Error ? err.message : "Could not load product reading.");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadProduct(slug, controller.signal);
    return () => controller.abort();
  }, [slug, loadProduct]);

  if (!detail) {
    if (error) {
      return (
        <main className="page-shell">
          <div className="error-panel" role="alert">
            <p className="eyebrow">Product reading unavailable</p>
            <h1>Unable to load product reading</h1>
            <p>{error}</p>
            <div className="error-actions">
              <button type="button" className="primary-button" onClick={() => loadProduct(slug)}>
                Retry
              </button>
              <Link className="secondary-link" to="/products">
                All products
              </Link>
              <Link className="secondary-link" to="/">
                Dashboard
              </Link>
            </div>
          </div>
        </main>
      );
    }
    return (
      <main className="page-shell">
        <EmptyState message={loading ? "Loading product reading..." : "Product reading unavailable."} />
      </main>
    );
  }
  const { product, mentions } = detail;
  const snapshot = product.snapshot;
  const maxSourceCount = snapshot
    ? Math.max(1, ...Object.values(snapshot.sourceBreakdown))
    : 1;
  return (
    <main className="page-shell">
      {error && (
        <div className="error-panel" role="alert">
          <p>{error}</p>
          <button type="button" className="primary-button" onClick={() => loadProduct(slug)}>
            Retry
          </button>
        </div>
      )}
      <section className="product-hero">
        <div>
          <p className="eyebrow">Microsoft 365 community barometer</p>
          <h1>{product.name}</h1>
          <p>{product.description}</p>
          <span className="last-analyzed">Last analyzed: {formatDate(product.lastAnalyzedAt)}{product.isStale ? " · stale" : ""}</span>
        </div>
        <div className="product-hero-aside">
          <MicrosoftInvestmentPanel investment={product.microsoftInvestment} />
          {snapshot ? <Score value={snapshot.barometerScore} size="large" /> : <span className="no-score">Pending first reading</span>}
        </div>
      </section>
      <SupplyDemand score={product.supplyDemand} />
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
                <div key={source}><span>{source}</span><div><i style={{ width: `${Math.min(100, Math.round((count / maxSourceCount) * 100))}%` }} /></div><strong>{count}</strong></div>
              ))}
            </div>
          </section>
          <section className="detail-band"><h2>Sample public mentions</h2><MentionList mentions={mentions} /></section>
        </>
      )}
    </main>
  );
}
