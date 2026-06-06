import { useEffect, useState } from "react";
import type { ProductSummary } from "../../shared/contracts";
import { api } from "../api";
import { EmptyState, ProductCard } from "../components";

type HomeResponse = { sections: Record<string, ProductSummary[]> };

const sectionTitles: Record<string, { title: string; description: string }> = {
  heatingUp: { title: "Heating Up", description: "Products gaining positive momentum." },
  coolingOff: { title: "Cooling Off", description: "Products losing positive momentum." },
  highestScores: { title: "Highest Scores", description: "The strongest current community readings." },
  lowestScores: { title: "Lowest Scores", description: "Products facing the most negative discussion." },
  mostDiscussed: { title: "Most Discussed", description: "The highest-volume conversations." },
  recentlyAnalyzed: { title: "Recently Analyzed", description: "The newest automated readings." },
};

export function DashboardPage() {
  const [data, setData] = useState<HomeResponse | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api<HomeResponse>("/api/home").then(setData).catch((err: Error) => setError(err.message)); }, []);

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
        {Object.entries(sectionTitles).map(([key, copy]) => (
          <section className="product-section" key={key}>
            <div className="section-heading"><div><h2>{copy.title}</h2><p>{copy.description}</p></div></div>
            <div className="product-grid">
              {(data?.sections[key] ?? []).map((product) => <ProductCard key={product.id} product={product} />)}
            </div>
            {data && data.sections[key]?.length === 0 && <EmptyState message="This section will populate after scheduled readings establish a trend." />}
          </section>
        ))}
      </div>
    </main>
  );
}
