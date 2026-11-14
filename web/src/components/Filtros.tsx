"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function Filtros({ campos }: { campos: { nombre: string; rotulo: string; valor: string; opciones: { valor: string; texto: string }[] }[] }) {
  const router = useRouter(), ruta = usePathname(), sp = useSearchParams();
  const cambiar = (nombre: string, valor: string) => {
    const p = new URLSearchParams(sp.toString());
    if (valor) p.set(nombre, valor); else p.delete(nombre);
    p.delete("pagina");
    if (nombre === "periodo") { p.delete("carrera"); }
    router.push(`${ruta}?${p.toString()}`);
  };
  return (
    <div className="filtros">
      {campos.map((c) => (
        <div className="filtro" key={c.nombre}>
          <label htmlFor={`f-${c.nombre}`}>{c.rotulo}</label>
          <select id={`f-${c.nombre}`} value={c.valor} onChange={(e) => cambiar(c.nombre, e.target.value)}>
            {c.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}
