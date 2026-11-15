"use client";
import { useTransition } from "react";
import { cambiarSeudonimizacion } from "@/lib/acciones-cuenta";

/**
 * Interruptor global de la barra superior (solo lo ve el administrador).
 * Encendido = datos seudonimizados en toda la aplicación; apagado = cédulas y nombres reales.
 */
export function SwitchIdentidad({ seudonimizado, hayIdentidades }: { seudonimizado: boolean; hayIdentidades: boolean }) {
  const [enviando, iniciar] = useTransition();
  const alternar = () => iniciar(async () => {
    const d = new FormData();
    d.set("seudonimizar", seudonimizado ? "no" : "si");
    await cambiarSeudonimizacion(d);
  });
  const ayuda = !hayIdentidades
    ? "La base no tiene cédulas ni nombres cargados: siempre se verá el código seudónimo. Para cargarlos, ejecuta la carga con INCLUIR_IDENTIDAD=1."
    : seudonimizado ? "Se muestran códigos seudónimos en toda la aplicación. Apágalo para ver cédulas y nombres."
      : "Se muestran cédulas y nombres reales. Enciéndelo para seudonimizar toda la aplicación.";
  return (
    <div className="switch-identidad" title={ayuda}>
      <button type="button" role="switch" aria-checked={seudonimizado} aria-label="Seudonimizar datos de estudiantes"
        className={`switch${seudonimizado ? " activo" : ""}`} disabled={enviando} onClick={alternar}><i /></button>
      <span>
        {seudonimizado ? "Datos seudonimizados" : "Datos reales visibles"}
        {!hayIdentidades && <small> · sin identidades cargadas</small>}
      </span>
    </div>
  );
}
