import { redirect } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { conDb } from "@/lib/db";
import { exigirUsuario } from "@/lib/sesion";
import { salir } from "../login/acciones";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const u = await exigirUsuario();
  if (u.debe_cambiar_password) redirect("/cambiar-clave");
  const altos = await conDb(async (sql) => {
    const [f] = await sql`SELECT count(*)::int AS n FROM alertas WHERE estado_periodo = 'EN_CURSO' AND nivel_riesgo = 'ALTO'`;
    return f?.n ?? 0;
  }).catch(() => 0);
  return (
    <div className="app">
      <Sidebar usuario={{ nombre: u.nombre, usuario: u.usuario, rol: u.rol }} altos={altos} salir={salir} />
      <div className="principal">
        <div className="barra">
          <form className="buscador" action="/resultados" role="search">
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="9" r="6" /><path d="M14 14l4 4" strokeLinecap="round" /></svg>
            <input name="q" placeholder="Buscar estudiante o carrera…" aria-label="Buscar" />
          </form>
          <span className="sub">Apoyo a la decisión humana · no es una decisión automatizada</span>
        </div>
        {children}
      </div>
    </div>
  );
}
