"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";

const ICONOS: Record<string, React.ReactNode> = {
  dashboard: <path d="M3 3h6v6H3zM11 3h6v4h-6zM11 9h6v8h-6zM3 11h6v6H3z" />,
  entrenamiento: <path d="M10 2.5v3M10 14.5v3M2.5 10h3M14.5 10h3M4.7 4.7l2.1 2.1M13.2 13.2l2.1 2.1M4.7 15.3l2.1-2.1M13.2 6.8l2.1-2.1M10 7.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z" />,
  resultados: <path d="M3 16.5h14M5.5 13V9M10 13V4.5M14.5 13V7" />,
  usuarios: <path d="M7.5 9a3 3 0 100-6 3 3 0 000 6zM2.5 16.5c0-2.8 2.2-4.5 5-4.5s5 1.700 5 4.5M13.5 8.500a2.500 2.500 0 000-5M15 12.300c1.500.600 2.500 2 2.500 4.200" />,
  configuracion: <path d="M10 12.500a2.500 2.500 0 100-5 2.500 2.500 0 000 5zM16 10a6 6 0 00-.100-1.100l1.600-1.200-1.500-2.600-1.900.700a6 6 0 00-1.900-1.100L11.900 2.700H8.100l-.300 2a6 6 0 00-1.900 1.100l-1.900-.700-1.500 2.600 1.600 1.200a6 6 0 000 2.200l-1.600 1.200 1.500 2.600 1.900-.700a6 6 0 001.900 1.100l.300 2h3.800l.300-2a6 6 0 001.900-1.100l1.900.700 1.500-2.600-1.600-1.200c.100-.400.100-.700.100-1.100z" />,
};

export function Sidebar({ usuario, altos, salir }: {
  usuario: { nombre: string; usuario: string; rol: string };
  altos: number;
  salir: () => Promise<void>;
}) {
  const ruta = usePathname();
  const items = [
    { href: "/dashboard", clave: "dashboard", texto: "Dashboard" },
    { href: "/entrenamiento", clave: "entrenamiento", texto: "Entrenamiento" },
    { href: "/resultados", clave: "resultados", texto: "Resultados", globo: altos },
    ...(usuario.rol === "ADMINISTRADOR" ? [{ href: "/usuarios", clave: "usuarios", texto: "Usuarios" }] : []),
    { href: "/configuracion", clave: "configuracion", texto: "Configuración" },
  ];
  const iniciales = usuario.nombre.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <aside className="sidebar">
      <div className="marca"><Logo /> Alertas Académicas</div>
      <nav className="nav" aria-label="Principal">
        <div className="nav-titulo">MENÚ</div>
        {items.map((i) => (
          <Link key={i.href} href={i.href} className={ruta.startsWith(i.href) ? "activo" : ""}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{ICONOS[i.clave]}</svg>
            {i.texto}
            {i.globo ? <span className="globo" title="Estudiantes en riesgo alto en la cohorte actual">{i.globo}</span> : null}
          </Link>
        ))}
      </nav>
      <div className="sidebar-pie">
        <div className="perfil">
          <div className="avatar">{iniciales}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{usuario.nombre}</div>
            <small>{usuario.rol === "ADMINISTRADOR" ? "Administrador" : "Docente"} · {usuario.usuario}</small>
          </div>
        </div>
        <form action={salir}><button className="btn" style={{ width: "100%", justifyContent: "center" }}>Cerrar sesión</button></form>
      </div>
    </aside>
  );
}
