"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, FileUp, LoaderCircle, Play, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isAdmin } from "@/lib/auth";
import { TrainingRun, trainingApi } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

const statusLabels: Record<TrainingRun["status"], string> = { queued: "En cola", running: "En curso", completed: "Completado", failed: "Falló" };

export default function EntrenamientoPage() {
  const [admin, setAdmin] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [runs, setRuns] = useState<TrainingRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try { setRuns(await trainingApi.list()); setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : "No se pudo consultar el historial"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { setAdmin(isAdmin()); }, []);
  useEffect(() => { if (admin) void refresh(); }, [admin, refresh]);
  useEffect(() => {
    if (!admin || !runs.some((run) => run.status === "queued" || run.status === "running")) return;
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [admin, runs, refresh]);

  async function startTraining(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setSubmitting(true); setError(""); setMessage("");
    try {
      const run = await trainingApi.start(file);
      setRuns((current) => [run, ...current]); setFile(null);
      const input = document.getElementById("training-dataset") as HTMLInputElement | null;
      if (input) input.value = "";
      setMessage("Archivo validado. El análisis se ejecuta en segundo plano; puedes salir de esta página y consultar el historial luego.");
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo iniciar el análisis"); }
    finally { setSubmitting(false); }
  }

  if (!admin) return <div className="page-stack"><div className="page-heading"><div><div className="eyebrow">MODELOS PREDICTIVOS</div><h1>Entrenamiento</h1></div></div><div className="notice notice-error">Solo el Administrador puede cargar conjuntos de datos y ejecutar análisis.</div></div>;

  const activeRuns = runs.filter((run) => run.status === "queued" || run.status === "running").length;
  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow">MODELOS PREDICTIVOS</div><h1>Entrenamiento</h1><p>Carga un conjunto de datos Excel y ejecuta el análisis académico.</p></div><Badge variant={activeRuns ? "warning" : "success"}>{activeRuns ? `${activeRuns} en curso` : "Listo para analizar"}</Badge></div>
    <div className="notice border-blue-200 bg-blue-50 text-blue-900"><div className="flex items-start gap-3"><Activity className="mt-0.5 h-5 w-5 shrink-0" /><div><div className="font-semibold">Este flujo evalúa y compara modelos sobre periodos cerrados.</div><p className="mt-1 text-sm text-blue-900/80">Los scripts generan métricas, un libro Excel y gráficos; no exportan un modelo listo para predecir estudiantes nuevos. El archivo se procesa temporalmente y se elimina al terminar.</p></div></div></div>
    <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
      <Card><CardHeader><CardTitle className="text-base">Cargar datos académicos</CardTitle><p className="text-xs text-slate-500">Archivo .xlsx, máximo 25 MB, primera hoja con el conjunto de datos.</p></CardHeader><CardContent>
        <form onSubmit={startTraining} className="space-y-4">
          <label htmlFor="training-dataset" className="form-label">Archivo del conjunto de datos<input id="training-dataset" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required className="mt-2 block w-full rounded-lg border border-slate-200 bg-white p-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-emerald-50 file:px-3 file:py-2 file:font-semibold file:text-emerald-800" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
          <div className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600"><strong>Este análisis requiere:</strong> las columnas del diccionario académico y los periodos `2023-2`, `2024-1`, `2024-2`, `2025-1` y `2025-2`. Entrena con los cuatro primeros y evalúa sobre `2025-2`.</div>
          {error && <div className="notice notice-error" role="alert">{error}</div>}{message && <div className="notice border-emerald-200 bg-emerald-50 text-emerald-800" role="status">{message}</div>}
          <div className="flex justify-end"><Button type="submit" disabled={!file || submitting}>{submitting ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Validando…</> : <><Play className="mr-2 h-4 w-4" />Iniciar análisis</>}</Button></div>
        </form>
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Qué ejecuta</CardTitle><p className="text-xs text-slate-500">Ambos archivos originales se conservan intactos.</p></CardHeader><CardContent className="space-y-3 text-sm text-slate-600"><div className="rounded-lg border border-slate-100 p-3"><strong>1. Análisis preliminar</strong><p className="mt-1 text-xs">Perfilado, comparación de regresión logística, Random Forest y XGBoost, validación, subgrupos, SHAP y gráficos.</p></div><div className="rounded-lg border border-slate-100 p-3"><strong>2. Comprobaciones complementarias</strong><p className="mt-1 text-xs">Recall a tasa de alerta fija, comparación A/B y análisis de sensibilidad sin 2024-2.</p></div><p className="text-xs text-slate-500">Los resultados se guardan en el historial de la aplicación y en Supabase Storage privado.</p></CardContent></Card>
    </div>
    <Card><CardHeader className="flex-row items-center justify-between gap-3"><div><CardTitle className="text-base">Historial de análisis</CardTitle><p className="mt-1 text-xs text-slate-500">Ejecuciones y estados guardados en Supabase.</p></div><Button variant="outline" size="sm" onClick={() => { setLoading(true); void refresh(); }}><RefreshCw className="mr-2 h-3.5 w-3.5" />Actualizar</Button></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs uppercase tracking-wide text-slate-400"><th className="pb-3 pr-4">Archivo</th><th className="pb-3 pr-4">Fecha</th><th className="pb-3 pr-4">Estado</th><th className="pb-3">Etapa</th></tr></thead><tbody>{loading ? <tr><td colSpan={4} className="py-8 text-center text-slate-500">Cargando historial…</td></tr> : runs.length ? runs.map((run) => <tr key={run.id} className="border-b border-slate-100 last:border-0"><td className="py-3 pr-4"><span className="font-medium text-slate-700">{run.dataset_name}</span><span className="block text-xs text-slate-400">{run.dataset_rows.toLocaleString()} filas</span></td><td className="whitespace-nowrap py-3 pr-4 text-xs text-slate-500">{formatDateTime(run.created_at)}</td><td className="py-3 pr-4"><Badge variant={run.status === "completed" ? "success" : run.status === "failed" ? "danger" : "warning"}>{statusLabels[run.status]} {run.status === "running" ? `${run.progress}%` : ""}</Badge></td><td className="min-w-52 py-3 text-xs text-slate-500">{run.error || run.stage}</td></tr>) : <tr><td colSpan={4} className="py-8 text-center text-slate-500">Todavía no hay análisis. Carga el archivo para crear la primera ejecución.</td></tr>}</tbody></table></div></CardContent></Card>
  </div>;
}
