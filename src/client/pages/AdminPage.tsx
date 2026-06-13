import { Archive, CheckCircle, LogOut, Pencil, Play, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import type { ProductSummary } from "../../shared/contracts";
import { api, formatDate } from "../api";

type Run = {
  id: string;
  product_name: string;
  status: string;
  trigger_type: string;
  requested_at: string;
  error_message?: string | null;
};

type Validation = {
  status: string;
  evidenceCount: number;
  sourceStatus: Record<string, string>;
  validatedAt: string | null;
};

type AdminProduct = ProductSummary & {
  analysisQuery: string;
  aliases: string[];
  sourceConfig: { subreddits?: string[] };
  lifecycleStatus: "draft" | "ready" | "active" | "archived";
  validation: Validation | null;
};

const blankProduct = { name: "", slug: "", description: "", analysisQuery: "", aliases: "", subreddits: "" };

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function generatedQuery(name: string, aliases: string) {
  const terms = [name, ...aliases.split(",")].map((item) => item.trim()).filter(Boolean);
  return [...new Set(terms)].map((term) => term.includes(" ") ? `"${term}"` : term).join(" OR ");
}

export function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [adminKey, setAdminKey] = useState("");
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [form, setForm] = useState(blankProduct);
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    try {
      const [productData, runData] = await Promise.all([
        api<{ products: AdminProduct[] }>("/admin/api/products"),
        api<{ runs: Run[] }>("/admin/api/analysis-runs"),
      ]);
      setProducts(productData.products);
      setRuns(runData.runs);
      setAuthenticated(true);
      setError("");
    } catch (err) {
      setAuthenticated(false);
      setError(err instanceof Error ? err.message : "Failed to load admin data");
    }
  }

  useEffect(() => { void load(); }, []);

  async function action(label: string, callback: () => Promise<unknown>) {
    setBusy(label);
    try {
      await callback();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy("");
    }
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    await action("login", () => api("/admin/api/login", { method: "POST", body: JSON.stringify({ key: adminKey }) }));
    setAdminKey("");
  }

  async function logout() {
    await api("/admin/api/logout", { method: "POST" });
    setAuthenticated(false);
    setProducts([]);
    setRuns([]);
  }

  async function saveProduct(event: FormEvent) {
    event.preventDefault();
    const query = form.analysisQuery.trim() || generatedQuery(form.name, form.aliases);
    await action("save", () => api(editing ? `/admin/api/products/${editing.id}` : "/admin/api/products", {
      method: editing ? "PATCH" : "POST",
      body: JSON.stringify({
        name: form.name,
        slug: form.slug || slugify(form.name),
        description: form.description,
        analysisQuery: query,
        aliases: form.aliases.split(",").map((item) => item.trim()).filter(Boolean),
        sourceConfig: { subreddits: form.subreddits.split(",").map((item) => item.trim().replace(/^r\//, "")).filter(Boolean) },
      }),
    }));
    setForm(blankProduct);
    setEditing(null);
  }

  function editProduct(product: AdminProduct) {
    setEditing(product);
    setForm({
      name: product.name,
      slug: product.slug,
      description: product.description ?? "",
      analysisQuery: product.analysisQuery,
      aliases: product.aliases.join(", "),
      subreddits: product.sourceConfig.subreddits?.join(", ") ?? "",
    });
  }

  if (authenticated !== true) {
    return (
      <main className="page-shell admin-login-shell">
        <form className="admin-login" onSubmit={(event) => void login(event)}>
          <p className="eyebrow">Administration</p>
          <h1>Enter admin key</h1>
          <p>The key creates a secure 12-hour browser session.</p>
          {error && <p className="form-error">{error}</p>}
          <label>Admin key<input type="password" required autoFocus value={adminKey} onChange={(event) => setAdminKey(event.target.value)} /></label>
          <button className="primary-button" disabled={busy === "login"} type="submit">Sign in</button>
        </form>
      </main>
    );
  }

  return (
    <main className="page-shell admin-shell">
      <div className="page-title admin-title">
        <div><p className="eyebrow">Operations</p><h1>Monitoring control room</h1><p>Add products as drafts, test Last30Days recognition, then activate successful products.</p></div>
        <div className="admin-actions">
          <button onClick={() => void load()} aria-label="Refresh admin data"><RefreshCw size={17} /></button>
          <button onClick={() => void logout()} aria-label="Sign out"><LogOut size={17} /></button>
          <button className="primary-button" disabled={Boolean(busy)} onClick={() => void action("all", () => api("/admin/api/analysis-runs/all", { method: "POST" }))}><Play size={16} /> Analyze active</button>
        </div>
      </div>
      {error && <p className="error-banner">{error}</p>}

      <section className="admin-section">
        <div className="section-heading"><div><h2>Tracked products</h2><p>Drafts must return at least three usable items before activation.</p></div></div>
        <div className="admin-table-wrap">
          <table>
            <thead><tr><th>Product</th><th>Lifecycle</th><th>Validation</th><th>Last analyzed</th><th>Actions</th></tr></thead>
            <tbody>{products.map((product) => (
              <tr key={product.id}>
                <td><strong>{product.name}</strong><small>{product.analysisQuery}</small></td>
                <td><span className={`run-status run-${product.lifecycleStatus === "active" ? "completed" : product.lifecycleStatus === "archived" ? "failed" : "pending"}`}>{product.lifecycleStatus}</span></td>
                <td>
                  <strong>{product.validation ? `${product.validation.evidenceCount} usable items` : "Not tested"}</strong>
                  <small>{product.validation ? Object.entries(product.validation.sourceStatus).map(([source, status]) => `${source}: ${status}`).join(" / ") : "Run Test Search before activation"}</small>
                </td>
                <td>{formatDate(product.lastAnalyzedAt)}</td>
                <td><div className="row-actions">
                  <button title="Test Last30Days search" disabled={Boolean(busy) || product.lifecycleStatus === "archived"} onClick={() => void action(`validate-${product.id}`, () => api(`/admin/api/products/${product.id}/validate`, { method: "POST" }))}><Search size={16} /></button>
                  <button title="Activate product" disabled={Boolean(busy) || product.lifecycleStatus !== "ready"} onClick={() => void action(`activate-${product.id}`, () => api(`/admin/api/products/${product.id}/activate`, { method: "POST" }))}><CheckCircle size={16} /></button>
                  <button title="Analyze product" disabled={Boolean(busy) || product.lifecycleStatus !== "active"} onClick={() => void action(product.id, () => api(`/admin/api/products/${product.id}/analyze`, { method: "POST" }))}><Play size={16} /></button>
                  <button title="Edit product" disabled={Boolean(busy)} onClick={() => editProduct(product)}><Pencil size={16} /></button>
                  <button title="Archive product" disabled={Boolean(busy) || product.lifecycleStatus === "archived"} onClick={() => void action(`archive-${product.id}`, () => api(`/admin/api/products/${product.id}/disable`, { method: "POST" }))}><Archive size={16} /></button>
                  <button title="Delete draft without history" disabled={Boolean(busy) || product.lifecycleStatus === "active"} onClick={() => void action(`delete-${product.id}`, () => api(`/admin/api/products/${product.id}`, { method: "DELETE" }))}><Trash2 size={16} /></button>
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="admin-section">
        <div className="section-heading">
          <div><h2>{editing ? `Edit ${editing.name}` : "Add product draft"}</h2><p>Name, aliases, and targeted subreddits make products recognizable to Last30Days.</p></div>
          {editing && <button className="icon-button" title="Cancel edit" onClick={() => { setEditing(null); setForm(blankProduct); }}><X size={17} /></button>}
        </div>
        <form className="product-form" onSubmit={(event) => void saveProduct(event)}>
          <label>Name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value, slug: editing ? form.slug : slugify(event.target.value) })} /></label>
          <label>Slug<input required pattern="[a-z0-9-]+" value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} /></label>
          <label className="span-two">Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          <label className="span-two">Aliases, comma-separated<input value={form.aliases} onChange={(event) => setForm({ ...form, aliases: event.target.value })} placeholder="Microsoft Teams Premium, Teams advanced meetings" /></label>
          <label className="span-two">Relevant subreddits, comma-separated<input value={form.subreddits} onChange={(event) => setForm({ ...form, subreddits: event.target.value })} placeholder="MicrosoftTeams, Microsoft365, sysadmin" /></label>
          <label className="span-two">Generated search query<textarea value={form.analysisQuery || generatedQuery(form.name, form.aliases)} onChange={(event) => setForm({ ...form, analysisQuery: event.target.value })} /></label>
          <button className="primary-button" disabled={busy === "save"} type="submit">{editing ? <Pencil size={16} /> : <Plus size={16} />} {editing ? "Save as draft" : "Add draft"}</button>
        </form>
      </section>

      <section className="admin-section">
        <div className="section-heading"><div><h2>Analysis runs</h2><p>Latest scheduled and manually triggered production analyses.</p></div></div>
        <div className="admin-table-wrap">
          <table>
            <thead><tr><th>Product</th><th>Status</th><th>Trigger</th><th>Requested</th><th>Result</th></tr></thead>
            <tbody>{runs.map((run) => <tr key={run.id}><td><strong>{run.product_name}</strong><small>{run.id}</small></td><td><span className={`run-status run-${run.status}`}>{run.status}</span></td><td>{run.trigger_type}</td><td>{formatDate(run.requested_at)}</td><td>{run.error_message ?? "-"}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
