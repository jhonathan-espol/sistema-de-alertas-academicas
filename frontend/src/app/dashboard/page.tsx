"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, AlertCircle, ArrowRight, CheckCircle2, Clock3, Plus, ShieldCheck, UsersRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, alertsApi } from "@/lib/api";
import { formatDateTime, roleLabel } from "@/lib/utils";
import { getUser, isAdmin } from "@/lib/auth";

const severityLabels: Record<string, string> = { critica: "Crítica", alta: "Alta", media: "Media", baja: "Baja" };

export default function DashboardPage() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("media");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [userName, setUserName] = useState("Usuario");
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    setUserName(getUser()?.username || "Usuario"); setAdmin(isAdmin());
    void loadAlerts();
  }, []);

  async function loadAlerts() {
    try { setAlerts(await alertsApi.list()); setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : "No se pudieron cargar las alertas"); }
    finally { setLoading(false); }
  }

  async function createAlert(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await alertsApi.create({ title, description, severity });
      setShowCreate(false); setTitle(""); setDescription(""); setSeverity("media"); setLoading(true); await loadAlerts();
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo guardar la alerta"); }
    finally { setBusy(false); }
  }

  const totals = useMemo(() => ({
    active: alerts.filter((item) => item.status === "activa").length,
    critical: alerts.filter((item) => item.severity === "critica" && item.status === "activa").length,
    resolved: alerts.filter((item) => item.status === "resuelta").length,
    archived: alerts.filter((item) => item.status === "archivada").length,
  }), [alerts]);
  const severityCounts = ["critica", "alta", "media", "baja"].map((key) => ({ key, count: alerts.filter((item) => item.severity === key).length }));

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div><div className="eyebrow">PANEL DE CONTROL</div><h1>Hola, {roleLabel(userName === "administrador" || userName === "admin" ? "administrador" : "invitado")}</h1><p>Este es el resumen de la actividad académica reciente.</p></div>
        <Button onClick={() => { setShowCreate(true); setError(""); }}><Plus className="mr-2 h-4 w-4" />Nueva alerta</Button>
      </div>

      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric title="Alertas registradas" value={alerts.length} icon={<Activity />} tint="blue" />
        <Metric title="Activas" value={totals.active} icon={<AlertCircle />} tint="rose" detail={totals.critical ? `${totals.critical} críticas` : "Sin alertas críticas"} />
        <Metric title="Resueltas" value={totals.resolved} icon={<CheckCircle2 />} tint="green" />
        <Metric title="Archivadas" value={totals.archived} icon={<Clock3 />} tint="amber" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.45fr_0.8fr]">
        <Card><CardHeader className="pb-3"><CardTitle className="text-base">Alertas por severidad</CardTitle><p className="text-xs text-slate-500">Distribución de los casos registrados.</p></CardHeader>
          <CardContent className="space-y-5">{severityCounts.map((item) => {
            const percent = alerts.length ? Math.round(item.count / alerts.length * 100) : 0;
            const colors: Record<string, string> = { critica: "bg-rose-500", alta: "bg-orange-500", media: "bg-amber-400", baja: "bg-emerald-500" };
            return <div key={item.key}><div className="mb-2 flex items-center justify-between text-sm"><span className="font-medium text-slate-700">{severityLabels[item.key]}</span><span className="text-slate-500">{item.count} <span className="text-slate-400">· {percent}%</span></span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full transition-all ${colors[item.key]}`} style={{ width: `${percent}%` }} /></div></div>;
          })}</CardContent>
        </Card>
        <Card><CardHeader className="pb-3"><CardTitle className="text-base">Accesos rápidos</CardTitle><p className="text-xs text-slate-500">Ve a una sección del sistema.</p></CardHeader><CardContent className="space-y-2">
          {admin && <QuickLink icon={<UsersRound />} title="Gestionar usuarios" detail="Cuentas y contraseñas" onClick={() => router.push("/dashboard/usuarios")} />}
          <QuickLink icon={<ShieldCheck />} title="Entrenamiento" detail="Modelos y datos" onClick={() => router.push("/dashboard/entrenamiento")} />
          <QuickLink icon={<Activity />} title="Ver resultados" detail="Historial de alertas" onClick={() => router.push("/dashboard/resultados")} />
        </CardContent></Card>
      </div>

      <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle className="text-base">Actividad reciente</CardTitle><p className="mt-1 text-xs text-slate-500">Últimas alertas registradas en el sistema.</p></div><button onClick={() => router.push("/dashboard/resultados")} className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-900">Ver resultados <ArrowRight className="h-3.5 w-3.5" /></button></CardHeader>
        <CardContent><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Alerta</TableHead><TableHead>Severidad</TableHead><TableHead>Estado</TableHead><TableHead className="hidden sm:table-cell">Fecha</TableHead></TableRow></TableHeader><TableBody>
          {loading ? <TableRow><TableCell colSpan={4} className="py-9 text-center text-slate-500">Cargando alertas…</TableCell></TableRow> : alerts.length ? alerts.slice(0, 6).map((alert) => <TableRow key={alert.id}><TableCell><span className="font-medium text-slate-800">{alert.title}</span>{alert.description && <span className="block max-w-[360px] truncate text-xs text-slate-400">{alert.description}</span>}</TableCell><TableCell><Badge variant={alert.severity === "critica" ? "danger" : alert.severity === "alta" ? "warning" : alert.severity === "baja" ? "success" : "default"}>{severityLabels[alert.severity] || alert.severity}</Badge></TableCell><TableCell><Badge variant={alert.status === "activa" ? "success" : alert.status === "resuelta" ? "info" : "default"}>{alert.status}</Badge></TableCell><TableCell className="hidden whitespace-nowrap text-xs text-slate-500 sm:table-cell">{formatDateTime(alert.created_at)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={4} className="py-10 text-center"><div className="text-sm font-medium text-slate-700">Aún no hay alertas</div><p className="mt-1 text-xs text-slate-400">Crea la primera alerta para empezar el seguimiento.</p></TableCell></TableRow>}
        </TableBody></Table></div></CardContent>
      </Card>

      {showCreate && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCreate(false); }}><Card className="modal-card" role="dialog" aria-modal="true" aria-labelledby="alert-title"><div className="flex items-start justify-between"><div><div className="eyebrow">SEGUIMIENTO</div><h2 id="alert-title" className="mt-1 text-xl font-bold">Nueva alerta</h2><p className="mt-1 text-sm text-slate-500">Registra una señal para darle seguimiento.</p></div><button className="icon-button" onClick={() => setShowCreate(false)} aria-label="Cerrar"><X className="h-5 w-5" /></button></div>
        <form onSubmit={createAlert} className="mt-6 space-y-4"><label className="form-label">Título<Input minLength={3} maxLength={255} required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ej. Riesgo de inasistencia" /></label><label className="form-label">Descripción<textarea className="min-h-24 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-600/20" maxLength={5000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Contexto y observaciones" /></label><label className="form-label">Severidad<select className="form-select" value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option><option value="critica">Crítica</option></select></label>{error && <div className="notice notice-error" role="alert">{error}</div>}<div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Crear alerta"}</Button></div></form>
      </Card></div>}
    </div>
  );
}

function Metric({ title, value, icon, tint, detail }: { title: string; value: number; icon: React.ReactNode; tint: string; detail?: string }) {
  const colors: Record<string, string> = { blue: "bg-blue-50 text-blue-700", rose: "bg-rose-50 text-rose-600", green: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-700" };
  return <Card><CardContent className="flex items-center gap-4 p-5"><div className={`metric-icon ${colors[tint]}`}>{icon}</div><div><div className="metric-label">{title}</div><div className="metric-value">{value}</div>{detail && <div className="mt-1 text-[11px] text-slate-400">{detail}</div>}</div></CardContent></Card>;
}

function QuickLink({ icon, title, detail, onClick }: { icon: React.ReactNode; title: string; detail: string; onClick: () => void }) {
  return <button onClick={onClick} className="group flex w-full items-center gap-3 rounded-xl border border-slate-100 p-3 text-left transition hover:border-emerald-100 hover:bg-emerald-50/50"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-50 text-slate-500 group-hover:bg-white group-hover:text-emerald-700">{icon}</span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-800">{title}</span><span className="block text-xs text-slate-400">{detail}</span></span><ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-emerald-700" /></button>;
}
