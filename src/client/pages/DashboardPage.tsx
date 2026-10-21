import { useEffect, useState } from "react";
import type { ProductSummary } from "../../shared/contracts";
import { homeSectionCopy, homeSectionOrder, type HomeSections } from "../../shared/home";
import { api } from "../api";
import { readHomeBootstrap } from "../bootstrap";
import { EmptyState, ProductCard } from "../components";

type HomeResponse = { sections: HomeSections };

export function DashboardPage() {
  const [data, setData] = useState<HomeResponse | null>(readHomeBootstrap);
  const [error, setError] = useState("");
  useEffect(() => {
    api<HomeResponse>("/api/home").then(setData).catch((err: Error) => setError(err.message));
  }, []);

  return (
    <main>
      <section className="dashboard-intro">
        <div>
          <p className="eyebrow">30-day community signal</p>
          <h1>Microsoft 365 sentiment, measured in public.</h1>
          <p>Automated weekly readings from recent community discussions, scored consistently over time.</p>
        </div>
        <div className="method-note">
          <strong>How to read it</strong>
          <span>Score measures sentiment. Momentum measures change from the previous reading.</span>
        </div>
      </section>
      {error && <p className="error-banner">{error}</p>}
      <div className="dashboard-sections">
        {homeSectionOrder.map((key) => {
          const copy = homeSectionCopy[key];
          const items = data?.sections[key] ?? [];
          return (
            <section className="product-section" key={key}>
              <div className="section-heading"><div><h2>{copy.title}</h2><p>{copy.description}</p></div></div>
              <div className="product-grid">
                {items.map((product: ProductSummary) => <ProductCard key={product.id} product={product} />)}
              </div>
              {data && items.length === 0 && <EmptyState message="This section will populate after scheduled readings establish a trend." />}
            </section>
          );
        })}
      </div>
    </main>
  );
}
