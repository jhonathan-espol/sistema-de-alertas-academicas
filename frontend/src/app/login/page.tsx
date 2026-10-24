"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authApi } from "@/lib/api";
import { setToken, setUser } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const response = await authApi.login(username, password);
      setToken(response.access_token); setUser(response.user); router.push("/dashboard");
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo iniciar sesión"); }
    finally { setLoading(false); }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f3f7f4] px-4 py-10">
      <div className="absolute -left-40 -top-44 h-[34rem] w-[34rem] rounded-full bg-emerald-100/70 blur-3xl" />
      <div className="absolute -bottom-48 -right-40 h-[34rem] w-[34rem] rounded-full bg-teal-100/70 blur-3xl" />
      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white bg-white shadow-[0_28px_90px_-38px_rgba(15,72,57,0.30)] md:grid-cols-[1fr_0.92fr]">
        <section className="relative hidden min-h-[590px] flex-col justify-between overflow-hidden bg-[#0c4c3d] p-10 text-white md:flex lg:p-14">
          <div className="absolute -right-24 top-20 h-72 w-72 rounded-full border border-white/10" />
          <div className="absolute -right-10 top-36 h-52 w-52 rounded-full border border-white/10" />
          <div className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-emerald-400/10 blur-2xl" />
          <div className="relative flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10"><ShieldCheck className="h-6 w-6" /></div><div><div className="text-sm font-semibold tracking-wide">ALERTAS</div><div className="text-[10px] uppercase tracking-[0.22em] text-emerald-200">Acompañamiento académico</div></div></div>
          <div className="relative max-w-sm"><div className="mb-5 h-1 w-12 rounded-full bg-emerald-300" /><h1 className="text-4xl font-semibold leading-[1.13] tracking-tight">Atención temprana.<br /><span className="text-emerald-200">Mejores oportunidades.</span></h1><p className="mt-5 text-sm leading-6 text-emerald-50/75">Una vista clara para identificar señales, acompañar trayectorias y dar seguimiento a cada caso.</p></div>
          <div className="relative text-xs text-emerald-100/60">Sistema de Alertas Académicas <span className="px-1.5">·</span> ESPOL</div>
        </section>
        <section className="flex min-h-[590px] flex-col justify-center px-7 py-10 sm:px-12 md:px-12 lg:px-16">
          <div className="mb-10 md:hidden"><div className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-700 text-white"><ShieldCheck className="h-6 w-6" /></div><div className="eyebrow">SISTEMA ACADÉMICO</div></div>
          <div className="mb-8"><div className="eyebrow">BIENVENIDO</div><h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Iniciar sesión</h2><p className="mt-2 text-sm text-slate-500">Ingresa tus credenciales para continuar.</p></div>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2"><label className="block text-sm font-medium text-slate-700">Usuario</label><div className="relative"><UserRound className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input type="text" placeholder="administrador o invitado" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} className="h-11 pl-10" required /></div></div>
            <div className="space-y-2"><label className="block text-sm font-medium text-slate-700">Contraseña</label><div className="relative"><LockKeyhole className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input type="password" placeholder="••••••••" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 pl-10" required /></div></div>
            {error && <div className="notice notice-error" role="alert">{error}</div>}
            <Button type="submit" className="h-11 w-full" disabled={loading}>{loading ? "Ingresando…" : <>Entrar al sistema <ArrowRight className="ml-2 h-4 w-4" /></>}</Button>
          </form>
          <p className="mt-8 border-t border-slate-100 pt-5 text-center text-xs text-slate-400">Acceso protegido <span className="px-1">·</span> Alertas Académicas</p>
        </section>
      </div>
    </div>
  );
}
