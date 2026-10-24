"use client";

import { Database, FileUp, GitBranch, Play, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const steps = [
  { number: "01", title: "Preparar los datos", description: "Cargar y validar el conjunto de datos académicos.", icon: FileUp },
  { number: "02", title: "Definir el modelo", description: "Seleccionar variables y parámetros del entrenamiento.", icon: GitBranch },
  { number: "03", title: "Ejecutar y comparar", description: "Guardar la ejecución y revisar su rendimiento.", icon: Play },
];

export default function EntrenamientoPage() {
  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow">MODELOS PREDICTIVOS</div><h1>Entrenamiento</h1><p>Preparación del flujo de entrenamiento de alertas tempranas.</p></div><Badge variant="warning">En preparación</Badge></div>
    <div className="notice border-amber-200 bg-amber-50 text-amber-900"><div className="flex items-start gap-3"><Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" /><div><div className="font-semibold">El proceso de entrenamiento todavía no está conectado a la aplicación.</div><p className="mt-1 text-sm text-amber-800/80">El proyecto incluye análisis Python; hace falta vincularlo a un servicio de ejecución y definir cómo se guardarán los modelos y sus resultados antes de habilitar entrenamientos desde aquí.</p></div></div></div>
    <div className="grid gap-4 lg:grid-cols-3">{steps.map((step) => { const Icon = step.icon; return <Card key={step.number}><CardContent className="p-5"><div className="flex items-center justify-between"><span className="text-xs font-bold tracking-[0.16em] text-emerald-700">PASO {step.number}</span><span className="metric-icon h-10 w-10 bg-slate-50 text-slate-500"><Icon /></span></div><h2 className="mt-5 text-base font-semibold text-slate-800">{step.title}</h2><p className="mt-2 min-h-10 text-sm leading-5 text-slate-500">{step.description}</p><div className="mt-5 border-t border-slate-100 pt-4"><Badge>Por configurar</Badge></div></CardContent></Card>; })}</div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle className="text-base">Datos académicos</CardTitle><p className="text-xs text-slate-500">Origen y validación de datos para el siguiente entrenamiento.</p></CardHeader><CardContent><div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-4"><div className="metric-icon bg-white text-emerald-700"><Database /></div><div><div className="text-sm font-semibold text-slate-800">Conexión pendiente</div><div className="text-xs text-slate-500">Define el formato de carga y los permisos de acceso al dataset.</div></div></div></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Historial de ejecuciones</CardTitle><p className="text-xs text-slate-500">Registro verificable de modelos entrenados y evaluados.</p></CardHeader><CardContent><div className="flex min-h-24 items-center justify-center rounded-xl border border-dashed border-slate-200 text-center"><div><div className="text-sm font-medium text-slate-600">No hay ejecuciones registradas</div><div className="mt-1 text-xs text-slate-400">Aparecerán cuando se conecte el proceso Python.</div></div></div></CardContent></Card>
    </div>
  </div>;
}
