"use client";
import { useActionState } from "react";
import { cambiarMiClave } from "@/lib/acciones-cuenta";

export function FormularioClave({ destino }: { destino?: string }) {
  const [estado, accion, enviando] = useActionState(cambiarMiClave, null);
  return (
    <form action={accion} className="formulario">
      {destino && <input type="hidden" name="destino" value={destino} />}
      <label className="campo"><span>Contraseña actual</span>
        <input className="entrada" type="password" name="actual" autoComplete="current-password" required />
      </label>
      <label className="campo"><span>Nueva contraseña (mínimo 8 caracteres, letras y números)</span>
        <input className="entrada" type="password" name="nueva" autoComplete="new-password" required minLength={8} />
      </label>
      <label className="campo"><span>Repite la nueva contraseña</span>
        <input className="entrada" type="password" name="repetir" autoComplete="new-password" required minLength={8} />
      </label>
      {estado?.error && <div className="aviso error">{estado.error}</div>}
      {estado?.ok && <div className="aviso exito">{estado.ok}</div>}
      <div><button className="btn btn-primario" disabled={enviando}>{enviando ? "Guardando…" : "Guardar contraseña"}</button></div>
    </form>
  );
}
