"use client";
import { useActionState } from "react";
import { guardarConfiguracion } from "@/lib/acciones-cuenta";

export function FormularioConfig({ editable, valores }: {
  editable: boolean; valores: { institucion: string; capacidad_semanal: string; mostrar_identidad_docente: boolean };
}) {
  const [e, accion, enviando] = useActionState(guardarConfiguracion, null);
  return (
    <form action={accion} className="formulario">
      <label className="campo"><span>Nombre de la institución</span>
        <input className="entrada" name="institucion" defaultValue={valores.institucion} disabled={!editable} maxLength={120} />
      </label>
      <label className="campo"><span>Capacidad de atención de bienestar (estudiantes por semana)</span>
        <input className="entrada" name="capacidad_semanal" type="number" min={1} max={1000} defaultValue={valores.capacidad_semanal} disabled={!editable} />
      </label>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <input type="checkbox" name="mostrar_identidad_docente" defaultChecked={valores.mostrar_identidad_docente} disabled={!editable} style={{ marginTop: 3 }} />
        <span>Mostrar cédula y nombre a los docentes<br /><span className="sub">Solo aplica cuando el interruptor “Datos seudonimizados” de la barra superior está apagado y las alertas se cargaron con identidad (INCLUIR_IDENTIDAD=1). Con el interruptor encendido, nadie ve identidades.</span></span>
      </label>
      {e?.error && <div className="aviso error">{e.error}</div>}
      {e?.ok && <div className="aviso exito">{e.ok}</div>}
      {editable && <div><button className="btn btn-primario" disabled={enviando}>{enviando ? "Guardando…" : "Guardar parámetros"}</button></div>}
    </form>
  );
}
