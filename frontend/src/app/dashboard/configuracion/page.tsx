"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Bell, Cloud, Database, KeyRound, ShieldCheck, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getUser, isAdmin } from "@/lib/auth";

export default function ConfiguracionPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState(false);
  const [username, setUsername] = useState("Usuario");
  useEffect(() => { setAdmin(isAdmin()); setUsername(getUser()?.username || "Usuario"); }, []);

  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow">PREFERENCIAS Y SEGURIDAD</div><h1>Configuración</h1><p>Información de tu cuenta y servicios del sistema.</p></div></div>
    <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
      <Card><CardHeader><CardTitle className="text-base">Tu cuenta</CardTitle></CardHeader><CardContent><div className="flex items-center gap-4 rounded-xl bg-slate-50 p-4"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-lg font-semibold text-emerald-800">{username.slice(0, 1).toUpperCase()}</div><div><div className="font-semibold text-slate-800">{username}</div><div className="mt-1 text-xs text-slate-500">{admin ? "Administrador" : "Invitado"}</div></div></div><div className="mt-5 space-y-3"><InfoRow icon={<ShieldCheck />} label="Acceso" value="Protegido por sesión" /><InfoRow icon={<KeyRound />} label="Contraseña" value="Gestionada por administración" /></div>{admin && <Button variant="outline" className="mt-5 w-full" onClick={() => router.push("/dashboard/usuarios")}><UsersRound className="mr-2 h-4 w-4" />Administrar usuarios<ArrowUpRight className="ml-auto h-4 w-4" /></Button>}</CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Servicios</CardTitle><p className="text-xs text-slate-500">Componentes que forman la aplicación desplegada.</p></CardHeader><CardContent className="space-y-3"><ServiceRow icon={<Database />} title="Base de datos" detail="PostgreSQL administrado en Supabase" tag="Supabase" /><ServiceRow icon={<Cloud />} title="API y autenticación" detail="FastAPI ejecutado como Python Worker" tag="Cloudflare" /><ServiceRow icon={<Cloud />} title="Aplicación web" detail="Next.js publicado con OpenNext" tag="Cloudflare" /><div className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/70 p-3"><Bell className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" /><div><div className="text-sm font-medium text-slate-700">Notificaciones externas</div><p className="mt-0.5 text-xs leading-5 text-slate-500">Correo y notificaciones push se conectarán en una iteración posterior.</p></div><Badge>Próximamente</Badge></div></CardContent></Card>
    </div>
    <p className="text-xs leading-5 text-slate-400">Las claves y variables privadas se administran en los paneles de Supabase y Cloudflare; nunca se muestran ni se guardan en el navegador.</p>
  </div>;
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="flex items-center gap-3"><span className="text-slate-400">{icon}</span><span className="text-sm text-slate-500">{label}</span><span className="ml-auto text-right text-sm font-medium text-slate-700">{value}</span></div>; }
function ServiceRow({ icon, title, detail, tag }: { icon: React.ReactNode; title: string; detail: string; tag: string }) { return <div className="flex items-center gap-3 rounded-xl border border-slate-100 p-3"><span className="metric-icon h-9 w-9 bg-slate-50 text-slate-600">{icon}</span><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-slate-800">{title}</div><div className="mt-0.5 text-xs text-slate-500">{detail}</div></div><Badge variant="info">{tag}</Badge></div>; }
