import { Pencil, Play, Plus, RefreshCw, ToggleLeft, ToggleRight, X } from "lucide-react";
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

type AdminProduct = ProductSummary & {
  analysisQuery: string;
  aliases: string[];
  sourceConfig: Record<string, unknown>;
};

type AiQuotaStatus = {
  limited: boolean;
  resetAt: string | null;
  message: string | null;
};

const blankProduct = {
  name: "",
  slug: "",
  description: "",
  analysisQuery: "",
  aliases: "",
};

export function AdminPage() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [aiQuota, setAiQuota] = useState<AiQuotaStatus>({ limited: false, resetAt: null, message: null });
  const [form, setForm] = useState(blankProduct);
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  async function load() {
    try {
      const [productData, runData, aiQuotaData] = await Promise.all([
        api<{ products: AdminProduct[] }>("/admin/api/products"),
        api<{ runs: Run[] }>("/admin/api/analysis-runs"),
        api<AiQuotaStatus>("/admin/api/ai-status"),
      ]);
      setProducts(productData.products);
      setRuns(runData.runs);
      setAiQuota(aiQuotaData);
      setError("");
    } catch (err) {
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

  async function saveProduct(event: FormEvent) {
    event.preventDefault();
    await action("save", () => api(editing ? `/admin/api/products/${editing.id}` : "/admin/api/products", {
      method: editing ? "PATCH" : "POST",
      body: JSON.stringify({
        name: form.name,
        slug: form.slug,
        description: form.description,
        analysisQuery: form.analysisQuery,
        aliases: form.aliases.split(",").map((item) => item.trim()).filter(Boolean),
        sourceConfig: editing?.sourceConfig ?? {},
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
    });
  }

  return (
    <main className="page-shell admin-shell">
      <div className="page-title admin-title">
        <div><p className="eyebrow">Operations</p><h1>Monitoring control room</h1><p>Manage the tracked portfolio and automated analysis runs.</p></div>
        <div className="admin-actions">
          <button onClick={() => void load()} aria-label="Refresh admin data"><RefreshCw size={17} /></button>
          <button className="primary-button" disabled={Boolean(busy) || aiQuota.limited} onClick={() => void action("all", () => api("/admin/api/analysis-runs/all", { method: "POST" }))}><Play size={16} /> Analyze all active</button>
        </div>
      </div>
      {error && <p className="error-banner">{error}</p>}
      {aiQuota.limited && (
        <div className="quota-banner" role="alert">
          <strong>Workers AI daily free-tier limit reached.</strong>
          <span>
            Analysis triggers are paused until {aiQuota.resetAt ? formatDate(aiQuota.resetAt) : "the next UTC daily reset"}.
          </span>
        </div>
      )}
      <section className="admin-section">
        <div className="section-heading"><div><h2>Tracked products</h2><p>Disabled products remain in history but stop receiving scheduled analyses.</p></div></div>
        <div className="admin-table-wrap">
          <table>
            <thead><tr><th>Product</th><th>Status</th><th>Last analyzed</th><th>Next scheduled</th><th>Actions</th></tr></thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td><strong>{product.name}</strong><small>{product.slug}</small></td>
                  <td><span className={product.isActive ? "status-active" : "status-disabled"}>{product.isActive ? "Active" : "Disabled"}</span></td>
                  <td>{formatDate(product.lastAnalyzedAt)}</td>
                  <td>{formatDate(product.nextAnalysisAt)}</td>
                  <td><div className="row-actions">
                    <button title={aiQuota.limited ? "Workers AI daily limit reached" : "Trigger analysis"} disabled={Boolean(busy) || aiQuota.limited} onClick={() => void action(product.id, () => api(`/admin/api/products/${product.id}/analyze`, { method: "POST" }))}><Play size={16} /></button>
                    <button title="Edit product" disabled={Boolean(busy)} onClick={() => editProduct(product)}><Pencil size={16} /></button>
                    <button title={product.isActive ? "Disable product" : "Enable product"} disabled={Boolean(busy)} onClick={() => void action(`toggle-${product.id}`, () => api(`/admin/api/products/${product.id}/${product.isActive ? "disable" : "enable"}`, { method: "POST" }))}>{product.isActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="admin-section">
        <div className="section-heading">
          <div><h2>{editing ? `Edit ${editing.name}` : "Add product"}</h2><p>Use a disambiguated query that clearly anchors the Microsoft context.</p></div>
          {editing && <button className="icon-button" title="Cancel edit" onClick={() => { setEditing(null); setForm(blankProduct); }}><X size={17} /></button>}
        </div>
        <form className="product-form" onSubmit={(event) => void saveProduct(event)}>
          <label>Name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Slug<input required pattern="[a-z0-9-]+" value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} /></label>
          <label className="span-two">Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          <label className="span-two">Analysis query<textarea required value={form.analysisQuery} onChange={(event) => setForm({ ...form, analysisQuery: event.target.value })} /></label>
          <label className="span-two">Aliases, comma-separated<input value={form.aliases} onChange={(event) => setForm({ ...form, aliases: event.target.value })} /></label>
          <button className="primary-button" disabled={busy === "save"} type="submit">{editing ? <Pencil size={16} /> : <Plus size={16} />} {editing ? "Save product" : "Add product"}</button>
        </form>
      </section>
      <section className="admin-section">
        <div className="section-heading"><div><h2>Analysis runs</h2><p>Latest scheduled and manually triggered automation attempts.</p></div></div>
        <div className="admin-table-wrap">
          <table>
            <thead><tr><th>Product</th><th>Status</th><th>Trigger</th><th>Requested</th><th>Result</th></tr></thead>
            <tbody>{runs.map((run) => <tr key={run.id}><td><strong>{run.product_name}</strong><small>{run.id}</small></td><td><span className={`run-status run-${run.status}`}>{run.status}</span></td><td>{run.trigger_type}</td><td>{formatDate(run.requested_at)}</td><td>{run.error_message ?? "—"}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
