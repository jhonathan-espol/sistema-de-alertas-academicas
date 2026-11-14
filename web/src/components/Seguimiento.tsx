"use client";
import { useActionState, useRef } from "react";
import { guardarSeguimiento } from "@/lib/acciones-cuenta";

const ESTADOS = [["PENDIENTE", "Pendiente"], ["CONTACTADO", "Contactado"], ["EN_ACOMPANAMIENTO", "En acompañamiento"], ["CERRADO", "Cerrado"]];

export function Seguimiento({ id, estado, nota, quien, titulo }: { id: number; estado: string; nota: string | null; quien: string | null; titulo: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [res, accion, enviando] = useActionState(guardarSeguimiento, null);
  const texto = ESTADOS.find((e) => e[0] === estado)?.[1] ?? estado;
  return (
    <>
      <button className="btn btn-mini" onClick={() => ref.current?.showModal()} title={nota ?? "Registrar seguimiento"}>{texto}</button>
      <dialog ref={ref}>
        <h2 style={{ fontSize: 17 }}>Seguimiento</h2>
        <p className="sub" style={{ marginBottom: 14 }}>{titulo}</p>
        <form action={accion} className="formulario">
          <input type="hidden" name="id" value={id} />
          <label className="campo"><span>Estado</span>
            <select name="estado" defaultValue={estado}>{ESTADOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
          </label>
          <label className="campo"><span>Nota (qué se hizo, qué se acordó)</span>
            <textarea className="entrada" name="nota" defaultValue={nota ?? ""} maxLength={1000} />
          </label>
          {quien && <p className="sub">Última actualización: {quien}</p>}
          {res?.error && <div className="aviso error">{res.error}</div>}
          {res?.ok && <div className="aviso exito">{res.ok}</div>}
          <div className="fila" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={() => ref.current?.close()}>Cerrar</button>
            <button className="btn btn-primario" disabled={enviando}>{enviando ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
