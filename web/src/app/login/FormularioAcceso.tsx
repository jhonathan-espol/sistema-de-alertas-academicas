"use client";
import { useActionState } from "react";
import { iniciarSesion } from "./acciones";

export function FormularioAcceso() {
  const [estado, accion, enviando] = useActionState(iniciarSesion, null);
  return (
    <form action={accion}>
      <label className="campo">
        <span>Usuario</span>
        <input className="entrada" name="usuario" autoComplete="username" required autoFocus />
      </label>
      <label className="campo">
        <span>Contraseña</span>
        <input className="entrada" name="password" type="password" autoComplete="current-password" required />
      </label>
      {estado?.error && <div className="aviso error">{estado.error}</div>}
      <button className="btn btn-primario" style={{ justifyContent: "center", padding: "10px" }} disabled={enviando}>
        {enviando ? "Verificando…" : "Ingresar"}
      </button>
    </form>
  );
}
