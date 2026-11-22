import { useCallback, useEffect, useState } from "react";
import type { ProductSummary } from "../../shared/contracts";
import { api } from "../api";
import { readProductsBootstrap } from "../bootstrap";
import { EmptyState, ProductCard } from "../components";

export function ProductsPage() {
  const initial = readProductsBootstrap();
  const [products, setProducts] = useState<ProductSummary[]>(() => initial ?? []);
  const [loading, setLoading] = useState<boolean>(() => !initial || initial.length === 0);
  const [error, setError] = useState<string>("");

  const loadProducts = useCallback((signal?: AbortSignal) => {
    setError("");
    setLoading(true);
    api<{ products: ProductSummary[] }>("/api/products", { signal })
      .then((data) => {
        if (signal?.aborted) return;
        setProducts(data.products);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
        setError(err instanceof Error ? err.message : "Could not load Microsoft 365 products.");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadProducts(controller.signal);
    return () => controller.abort();
  }, [loadProducts]);

  return (
    <main className="page-shell">
      <div className="page-title">
        <p className="eyebrow">Tracked portfolio</p>
        <h1>Microsoft 365 Products</h1>
        <p>Every active product receives an automated Last30Days reading once per week.</p>
      </div>
      {error && (
        <div className="error-panel" role="alert">
          <p>{error}</p>
          <button type="button" className="primary-button" onClick={() => loadProducts()}>
            Retry
          </button>
        </div>
      )}
      {loading && products.length === 0 && !error ? (
        <EmptyState message="Loading Microsoft 365 products..." />
      ) : !loading && products.length === 0 && !error ? (
        <EmptyState message="No active products found." />
      ) : (
        <div className="product-grid wide">
          {products.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
      )}
    </main>
  );
}
