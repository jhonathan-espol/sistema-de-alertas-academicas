"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Archive, Check, CircleAlert, Download, FileDown, RefreshCw } from "lucide-react";
import { Alert, alertsApi, TrainingRun, trainingApi } from "@/lib/api";
import { isAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const severityName: Record<string, string> = { critica: "Crítica", alta: "Alta", media: "Media", baja: "Baja" };

export default function ResultadosPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [filter, setFilter] = useState("todas");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => { void reload(); }, []);

  async function reload() {
    try { setAlerts(await alertsApi.list()); setMessage(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudieron cargar los resultados"); }
    finally { setLoading(false); }
  }

  async function setStatus(alert: Alert, status: string) {
    setWorking(alert.id); setMessage("");
    try { await alertsApi.update(alert.id, { status }); await reload(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo actualizar la alerta"); }
    finally { setWorking(null); }
  }

  const totals = useMemo(() => ({ active: alerts.filter((a) => a.status === "activa").length, resolved: alerts.filter((a) => a.status === "resuelta").length, critical: alerts.filter((a) => a.severity === "critica").length }), [alerts]);
  const visible = filter === "todas" ? alerts : alerts.filter((alert) => alert.status === filter);

  function downloadCsv() {
    const rows = [["Título", "Descripción", "Severidad", "Estado", "Creada"], ...visible.map((a) => [a.title, a.description || "", severityName[a.severity] || a.severity, a.status, a.created_at])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" })); link.download = "resultados-alertas.csv"; link.click(); URL.revokeObjectURL(link.href);
  }

  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow">SEGUIMIENTO</div><h1>Resultados</h1><p>Revisa las alertas y actualiza su estado de atención.</p></div><div className="flex gap-2"><Button variant="outline" onClick={downloadCsv} disabled={!visible.length}><Download className="mr-2 h-4 w-4" />Exportar CSV</Button><Button variant="outline" onClick={() => { setLoading(true); void reload(); }}><RefreshCw className="mr-2 h-4 w-4" />Actualizar</Button></div></div>
    <TrainingResults />
    {message && <div className="notice notice-error" role="alert">{message}</div>}
    <div className="grid gap-4 sm:grid-cols-3"><Metric title="Alertas totales" value={alerts.length} icon={<Activity />} tint="blue" /><Metric title="En seguimiento" value={totals.active} icon={<CircleAlert />} tint="amber" /><Metric title="Resueltas" value={totals.resolved} icon={<Check />} tint="green" /></div>
    <Card><CardHeader className="flex-row items-center justify-between gap-3"><div><CardTitle className="text-base">Historial de alertas</CardTitle><p className="mt-1 text-xs text-slate-500">{totals.critical} casos críticos registrados</p></div><select className="form-select max-w-40" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filtrar alertas"><option value="todas">Todos los estados</option><option value="activa">Activas</option><option value="resuelta">Resueltas</option><option value="archivada">Archivadas</option></select></CardHeader>
      <CardContent><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs uppercase tracking-wide text-slate-400"><th className="pb-3 pr-4 font-semibold">Alerta</th><th className="pb-3 pr-4 font-semibold">Severidad</th><th className="pb-3 pr-4 font-semibold">Estado</th><th className="hidden pb-3 pr-4 font-semibold md:table-cell">Fecha</th><th className="pb-3 text-right font-semibold">Acción</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={5} className="py-10 text-center text-slate-500">Cargando resultados…</td></tr> : visible.length ? visible.map((alert) => <tr key={alert.id} className="border-b border-slate-100 last:border-0"><td className="py-4 pr-4"><span className="font-semibold text-slate-800">{alert.title}</span>{alert.description && <span className="block max-w-md truncate text-xs text-slate-400">{alert.description}</span>}</td><td className="py-4 pr-4"><Badge variant={alert.severity === "critica" ? "danger" : alert.severity === "alta" ? "warning" : alert.severity === "baja" ? "success" : "default"}>{severityName[alert.severity] || alert.severity}</Badge></td><td className="py-4 pr-4"><Badge variant={alert.status === "activa" ? "success" : alert.status === "resuelta" ? "info" : "default"}>{alert.status}</Badge></td><td className="hidden whitespace-nowrap py-4 pr-4 text-xs text-slate-500 md:table-cell">{formatDateTime(alert.created_at)}</td><td className="py-4 text-right">{alert.status === "activa" ? <Button size="sm" variant="outline" disabled={working === alert.id} onClick={() => void setStatus(alert, "resuelta")}><Check className="mr-1 h-3.5 w-3.5" />Resolver</Button> : alert.status === "resuelta" ? <Button size="sm" variant="ghost" disabled={working === alert.id} onClick={() => void setStatus(alert, "archivada")}><Archive className="mr-1 h-3.5 w-3.5" />Archivar</Button> : <span className="text-xs text-slate-400">Finalizada</span>}</td></tr>) : <tr><td colSpan={5} className="py-12 text-center"><div className="text-sm font-medium text-slate-700">No hay alertas en esta vista</div><p className="mt-1 text-xs text-slate-400">Las alertas nuevas aparecerán aquí.</p></td></tr>}
      </tbody></table></div></CardContent>
    </Card>
  </div>;
}

function Metric({ title, value, icon, tint }: { title: string; value: number; icon: React.ReactNode; tint: string }) {
  const colors: Record<string, string> = { blue: "bg-blue-50 text-blue-700", amber: "bg-amber-50 text-amber-700", green: "bg-emerald-50 text-emerald-700" };
  return <Card><CardContent className="flex items-center gap-4 p-5"><div className={`metric-icon ${colors[tint]}`}>{icon}</div><div><div className="metric-label">{title}</div><div className="metric-value">{value}</div></div></CardContent></Card>;
}

const modelFigures = [
  ["fig1_casos_por_periodo.png", "Casos por periodo"],
  ["fig2_curvas_PR_validacion.png", "Curvas precisión-sensibilidad"],
  ["fig3_comparacion_modelos.png", "Comparación de modelos"],
  ["fig4_shap_importancia.png", "Importancia SHAP"],
  ["fig5_subgrupos_FNR.png", "Falsos negativos por subgrupo"],
] as const;

function TrainingResults() {
  const [admin, setAdmin] = useState(false);
  const [runs, setRuns] = useState<TrainingRun[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [figures, setFigures] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setAdmin(isAdmin()); }, []);
  useEffect(() => {
    if (!admin) { setLoading(false); return; }
    let current = true;
    void trainingApi.list().then((items) => {
      if (!current) return;
      setRuns(items);
      setSelectedId(items.find((item) => item.status === "completed")?.id || "");
      setError("");
    }).catch((err) => { if (current) setError(err instanceof Error ? err.message : "No se pudieron cargar los análisis"); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [admin]);

  const selected = runs.find((run) => run.id === selectedId && run.status === "completed") || null;
  useEffect(() => {
    if (!selected) { setFigures({}); return; }
    let current = true;
    const urls: string[] = [];
    setFigures({});
    void Promise.all(modelFigures.map(async ([name]) => {
      if (!selected.artifacts.includes(name)) return [name, ""] as const;
      const blob = await trainingApi.file(selected.id, name);
      const url = URL.createObjectURL(blob); urls.push(url);
      return [name, url] as const;
    })).then((items) => { if (current) setFigures(Object.fromEntries(items)); })
      .catch((err) => { if (current) setError(err instanceof Error ? err.message : "No se pudieron cargar los gráficos"); });
    return () => { current = false; urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [selected?.id]);

  async function downloadWorkbook() {
    if (!selected) return;
    setDownloading(true); setError("");
    try {
      const blob = await trainingApi.file(selected.id, "resultados_preliminares.xlsx");
      const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = `resultados-${selected.id.slice(0, 8)}.xlsx`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo descargar el Excel"); }
    finally { setDownloading(false); }
  }

  return <Card><CardHeader className="flex-row flex-wrap items-center justify-between gap-3"><div><CardTitle className="text-base">Análisis de modelos</CardTitle><p className="mt-1 text-xs text-slate-500">Métricas, gráficos y libros producidos por los scripts Python.</p></div>{selected && <div className="flex flex-wrap items-center gap-2"><select className="form-select max-w-64" aria-label="Seleccionar análisis" value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>{runs.filter((run) => run.status === "completed").map((run) => <option key={run.id} value={run.id}>{new Date(run.created_at).toLocaleString("es-EC")} · {run.dataset_name}</option>)}</select><Button variant="outline" size="sm" disabled={downloading} onClick={() => void downloadWorkbook()}><FileDown className="mr-2 h-4 w-4" />{downloading ? "Descargando…" : "Excel"}</Button></div>}</CardHeader><CardContent>
    {error && <div className="notice notice-error mb-4" role="alert">{error}</div>}
    {loading ? <div className="py-8 text-center text-sm text-slate-500">Cargando resultados de entrenamiento…</div> : !admin ? <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">Los resultados de los modelos están disponibles para Administradores.</div> : !runs.some((run) => run.status === "completed") ? <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">Aún no hay análisis completados. Carga el conjunto de datos desde Entrenamiento.</div> : selected && <>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><SummaryMetric label="Mejor modelo" value={`${selected.result_summary?.mejor?.[0] || "—"} [${selected.result_summary?.mejor?.[1] || "—"}]`} /><SummaryMetric label="AUC-PR validación" value={formatMetric(selected.result_summary?.best_metrics?.AUC_PR)} /><SummaryMetric label="Recall" value={formatMetric(selected.result_summary?.best_metrics?.Recall)} /><SummaryMetric label="Prevalencia" value={formatMetric(selected.result_summary?.prevalencia_val)} /></div>
      <div className="mb-4 text-xs text-slate-500">Archivo: {selected.dataset_name} · {selected.dataset_rows.toLocaleString()} filas · Ejecutado {formatDateTime(selected.created_at)}</div>
      <div className="grid gap-4 lg:grid-cols-2">{modelFigures.map(([name, title]) => figures[name] ? <figure key={name} className="overflow-hidden rounded-xl border border-slate-100 bg-white"><figcaption className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">{title}</figcaption><img src={figures[name]} alt={title} className="h-auto w-full" /></figure> : null)}</div>
      <p className="mt-4 text-xs text-slate-500">Las métricas de validación describen el conjunto 2025-2. Revisa criterios, intervalos y subgrupos en el libro Excel.</p>
    </>}
  </CardContent></Card>;
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4"><div className="text-xs font-medium text-slate-500">{label}</div><div className="mt-1 truncate text-lg font-semibold text-slate-800">{value}</div></div>;
}

function formatMetric(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("es-EC", { maximumFractionDigits: 3 }) : "—";
}
