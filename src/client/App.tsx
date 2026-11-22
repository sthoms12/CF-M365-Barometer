import { lazy, Suspense } from "react";
import { Activity, BookOpen, Gauge, LayoutGrid } from "lucide-react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import { DashboardPage } from "./pages/DashboardPage";

const loadProductsPage = () => import("./pages/ProductsPage");
const loadProductPage = () => import("./pages/ProductPage");
const ProductsPage = lazy(() => loadProductsPage().then((module) => ({ default: module.ProductsPage })));
const ProductPage = lazy(() => loadProductPage().then((module) => ({ default: module.ProductPage })));

let readyProducts: typeof import("./pages/ProductsPage") | null = null;
let readyProduct: typeof import("./pages/ProductPage") | null = null;

export function preloadCurrentRoute(): Promise<void> {
  const path = window.location.pathname;
  if (path === "/products") return loadProductsPage().then((module) => { readyProducts = module; });
  if (/^\/products\/[^/]+\/?$/.test(path)) return loadProductPage().then((module) => { readyProduct = module; });
  return Promise.resolve();
}

function CurrentProductsPage() {
  if (!readyProducts) return <ProductsPage />;
  const Page = readyProducts.ProductsPage;
  return <Page />;
}

function CurrentProductPage() {
  if (!readyProduct) return <ProductPage />;
  const Page = readyProduct.ProductPage;
  return <Page />;
}

function Header() {
  return (
    <header className="site-header">
      <NavLink to="/" className="brand">
        <span className="brand-mark"><Gauge size={20} /></span>
        <span>M365 Barometer</span>
      </NavLink>
      <nav className="nav-links" aria-label="Primary navigation">
        <NavLink to="/" end><Activity size={16} /> <span>Dashboard</span></NavLink>
        <NavLink to="/products"><LayoutGrid size={16} /> <span>Products</span></NavLink>
        <a href="/methodology"><BookOpen size={16} /> <span>Methodology</span></a>
      </nav>
    </header>
  );
}

function RouteFallback() {
  return <main className="page-shell" aria-busy="true" />;
}

export function NotFoundPage() {
  return (
    <main className="page-shell">
      <div className="error-panel not-found-panel">
        <p className="eyebrow">404 — Page not found</p>
        <h1>This barometer route does not exist.</h1>
        <p>The page you requested could not be found. Browse the live Microsoft 365 sentiment dashboard or product directory below.</p>
        <div className="error-actions">
          <Link className="primary-button" to="/">
            Back to Dashboard
          </Link>
          <Link className="secondary-link" to="/products">
            Browse all products
          </Link>
          <a className="secondary-link" href="/methodology">
            Read methodology
          </a>
        </div>
      </div>
    </main>
  );
}

export function App() {
  return (
    <>
      <Header />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/products" element={<CurrentProductsPage />} />
          <Route path="/products/:slug" element={<CurrentProductPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </>
  );
}
