"use client";
import { useActionState, useRef } from "react";
import { crearUsuario, editarUsuario, eliminarUsuario, restablecerClave, type Estado } from "@/lib/acciones-cuenta";

function Mensaje({ e }: { e: Estado }) {
  if (e?.error) return <div className="aviso error">{e.error}</div>;
  if (e?.ok) return <div className="aviso exito">{e.ok}</div>;
  return null;
}

function Roles({ valor }: { valor?: string }) {
  return (
    <select name="rol" defaultValue={valor ?? "DOCENTE"}>
      <option value="DOCENTE">Docente</option>
      <option value="ADMINISTRADOR">Administrador</option>
    </select>
  );
}

export function NuevoUsuario() {
  const ref = useRef<HTMLDialogElement>(null);
  const [e, accion, enviando] = useActionState(crearUsuario, null);
  return (
    <>
      <button className="btn btn-primario" onClick={() => ref.current?.showModal()}>Nuevo usuario</button>
      <dialog ref={ref}>
        <h2 style={{ fontSize: 17, marginBottom: 14 }}>Nuevo usuario</h2>
        <form action={accion} className="formulario">
          <label className="campo"><span>Usuario (para iniciar sesión)</span><input className="entrada" name="usuario" required minLength={3} maxLength={40} /></label>
          <label className="campo"><span>Nombre completo</span><input className="entrada" name="nombre" required maxLength={120} /></label>
          <label className="campo"><span>Rol</span><Roles /></label>
          <label className="campo"><span>Contraseña temporal (mínimo 8, letras y números)</span><input className="entrada" name="password" type="password" required minLength={8} autoComplete="new-password" /></label>
          <Mensaje e={e} />
          <div className="fila" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={() => ref.current?.close()}>Cerrar</button>
            <button className="btn btn-primario" disabled={enviando}>{enviando ? "Creando…" : "Crear usuario"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

type U = { id: number; usuario: string; nombre: string; rol: string; activo: boolean; temporal: boolean; acceso: string; creado: string };

export function FilaUsuario({ u, esYo }: { u: U; esYo: boolean }) {
  const dEditar = useRef<HTMLDialogElement>(null), dClave = useRef<HTMLDialogElement>(null), dBorrar = useRef<HTMLDialogElement>(null);
  const [eEditar, aEditar, pEditar] = useActionState(editarUsuario, null);
  const [eClave, aClave, pClave] = useActionState(restablecerClave, null);
  const [eBorrar, aBorrar, pBorrar] = useActionState(eliminarUsuario, null);
  return (
    <tr>
      <td style={{ fontWeight: 600 }}>{u.usuario}{esYo && <span className="chip info" style={{ marginLeft: 8 }}>Tú</span>}</td>
      <td>{u.nombre}</td>
      <td>{u.rol === "ADMINISTRADOR" ? "Administrador" : "Docente"}</td>
      <td>
        <span className={`chip ${u.activo ? "ok" : "neutro"}`}>{u.activo ? "Activo" : "Inactivo"}</span>
        {u.temporal && <div className="sub" style={{ marginTop: 3 }}>Contraseña temporal</div>}
      </td>
      <td className="nw">{u.acceso}</td>
      <td className="nw">{u.creado}</td>
      <td>
        <div className="fila" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
          <button className="btn btn-mini" onClick={() => dEditar.current?.showModal()}>Editar</button>
          <button className="btn btn-mini" onClick={() => dClave.current?.showModal()}>Cambiar contraseña</button>
          {!esYo && <button className="btn btn-mini btn-peligro" onClick={() => dBorrar.current?.showModal()}>Eliminar</button>}
        </div>

        <dialog ref={dEditar}>
          <h2 style={{ fontSize: 17, marginBottom: 14 }}>Editar {u.usuario}</h2>
          <form action={aEditar} className="formulario">
            <input type="hidden" name="id" value={u.id} />
            <label className="campo"><span>Nombre completo</span><input className="entrada" name="nombre" defaultValue={u.nombre} required maxLength={120} /></label>
            <label className="campo"><span>Rol</span><Roles valor={u.rol} /></label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="activo" defaultChecked={u.activo} /> Cuenta activa (puede iniciar sesión)</label>
            <Mensaje e={eEditar} />
            <div className="fila" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => dEditar.current?.close()}>Cerrar</button>
              <button className="btn btn-primario" disabled={pEditar}>Guardar</button>
            </div>
          </form>
        </dialog>

        <dialog ref={dClave}>
          <h2 style={{ fontSize: 17 }}>Cambiar contraseña de {u.usuario}</h2>
          <p className="sub" style={{ marginBottom: 14 }}>Será temporal: el usuario deberá definir una nueva al ingresar.</p>
          <form action={aClave} className="formulario">
            <input type="hidden" name="id" value={u.id} />
            <label className="campo"><span>Nueva contraseña (mínimo 8, letras y números)</span><input className="entrada" name="password" type="password" required minLength={8} autoComplete="new-password" /></label>
            <Mensaje e={eClave} />
            <div className="fila" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => dClave.current?.close()}>Cerrar</button>
              <button className="btn btn-primario" disabled={pClave}>Cambiar contraseña</button>
            </div>
          </form>
        </dialog>

        <dialog ref={dBorrar}>
          <h2 style={{ fontSize: 17 }}>Eliminar a {u.usuario}</h2>
          <p className="sub" style={{ margin: "6px 0 14px" }}>La cuenta se borra de forma permanente. Si solo quieres impedir el acceso, desactívala desde Editar.</p>
          <form action={aBorrar} className="formulario">
            <input type="hidden" name="id" value={u.id} />
            <Mensaje e={eBorrar} />
            <div className="fila" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => dBorrar.current?.close()}>Cancelar</button>
              <button className="btn btn-peligro" disabled={pBorrar}>Eliminar definitivamente</button>
            </div>
          </form>
        </dialog>
      </td>
    </tr>
  );
}
