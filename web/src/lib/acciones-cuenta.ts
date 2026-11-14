"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { conDb } from "./db";
import { hashPassword, validarPassword, verificarPassword } from "./password";
import { exigirAdmin, exigirUsuario } from "./sesion";

export type Estado = { error?: string; ok?: string } | null;

export async function cambiarMiClave(_: Estado, datos: FormData): Promise<Estado> {
  const u = await exigirUsuario();
  const actual = String(datos.get("actual") ?? "");
  const nueva = String(datos.get("nueva") ?? "");
  if (nueva !== String(datos.get("repetir") ?? "")) return { error: "Las contraseñas nuevas no coinciden." };
  const invalida = validarPassword(nueva);
  if (invalida) return { error: invalida };
  if (nueva === actual) return { error: "La nueva contraseña debe ser distinta de la actual." };
  const ok = await conDb(async (sql) => {
    const [f] = await sql`SELECT password_hash FROM usuarios WHERE id = ${u.id}`;
    if (!f || !(await verificarPassword(actual, f.password_hash))) return false;
    await sql`UPDATE usuarios SET password_hash = ${await hashPassword(nueva)}, debe_cambiar_password = FALSE, actualizado_en = now() WHERE id = ${u.id}`;
    return true;
  });
  if (!ok) return { error: "La contraseña actual no es correcta." };
  const destino = String(datos.get("destino") ?? "");
  if (destino.startsWith("/")) redirect(destino);
  return { ok: "Contraseña actualizada." };
}

// ---------------------------------------------------------------- usuarios (solo administrador)
export async function crearUsuario(_: Estado, datos: FormData): Promise<Estado> {
  await exigirAdmin();
  const usuario = String(datos.get("usuario") ?? "").trim();
  const nombre = String(datos.get("nombre") ?? "").trim();
  const rol = String(datos.get("rol") ?? "");
  const clave = String(datos.get("password") ?? "");
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(usuario)) return { error: "El usuario debe tener de 3 a 40 caracteres (letras, números, punto, guion)." };
  if (!nombre) return { error: "Ingresa el nombre." };
  if (!["ADMINISTRADOR", "DOCENTE"].includes(rol)) return { error: "Rol no válido." };
  const invalida = validarPassword(clave);
  if (invalida) return { error: invalida };
  const creado = await conDb(async (sql) => {
    const [ya] = await sql`SELECT 1 FROM usuarios WHERE lower(usuario) = lower(${usuario})`;
    if (ya) return false;
    await sql`INSERT INTO usuarios (usuario, nombre, rol, password_hash) VALUES (${usuario}, ${nombre}, ${rol}, ${await hashPassword(clave)})`;
    return true;
  });
  if (!creado) return { error: "Ya existe un usuario con ese nombre." };
  revalidatePath("/usuarios");
  return { ok: `Usuario ${usuario} creado. Deberá cambiar la contraseña en su primer ingreso.` };
}

export async function editarUsuario(_: Estado, datos: FormData): Promise<Estado> {
  const yo = await exigirAdmin();
  const id = Number(datos.get("id"));
  const nombre = String(datos.get("nombre") ?? "").trim();
  const rol = String(datos.get("rol") ?? "");
  const activo = datos.get("activo") === "on";
  if (!nombre) return { error: "Ingresa el nombre." };
  if (!["ADMINISTRADOR", "DOCENTE"].includes(rol)) return { error: "Rol no válido." };
  if (id === yo.id && (!activo || rol !== "ADMINISTRADOR")) return { error: "No puedes desactivar ni quitar el rol de administrador a tu propia cuenta." };
  const res = await conDb(async (sql) => {
    if (!activo || rol !== "ADMINISTRADOR") {
      const [f] = await sql`SELECT count(*)::int AS n FROM usuarios WHERE rol = 'ADMINISTRADOR' AND activo AND id <> ${id}`;
      if (f.n === 0) return "Debe quedar al menos un administrador activo.";
    }
    await sql`UPDATE usuarios SET nombre = ${nombre}, rol = ${rol}, activo = ${activo}, actualizado_en = now() WHERE id = ${id}`;
    return null;
  });
  if (res) return { error: res };
  revalidatePath("/usuarios");
  return { ok: "Usuario actualizado." };
}

export async function restablecerClave(_: Estado, datos: FormData): Promise<Estado> {
  await exigirAdmin();
  const id = Number(datos.get("id"));
  const clave = String(datos.get("password") ?? "");
  const invalida = validarPassword(clave);
  if (invalida) return { error: invalida };
  await conDb(async (sql) => {
    await sql`UPDATE usuarios SET password_hash = ${await hashPassword(clave)}, debe_cambiar_password = TRUE, actualizado_en = now() WHERE id = ${id}`;
  });
  revalidatePath("/usuarios");
  return { ok: "Contraseña restablecida. El usuario deberá cambiarla al ingresar." };
}

export async function eliminarUsuario(_: Estado, datos: FormData): Promise<Estado> {
  const yo = await exigirAdmin();
  const id = Number(datos.get("id"));
  if (id === yo.id) return { error: "No puedes eliminar tu propia cuenta." };
  await conDb((sql) => sql`DELETE FROM usuarios WHERE id = ${id}`);
  revalidatePath("/usuarios");
  return { ok: "Usuario eliminado." };
}

// ---------------------------------------------------------------- configuración y seguimiento
export async function guardarConfiguracion(_: Estado, datos: FormData): Promise<Estado> {
  await exigirAdmin();
  const institucion = String(datos.get("institucion") ?? "").trim().slice(0, 120);
  const capacidad = Math.max(1, Math.min(1000, Number(datos.get("capacidad_semanal")) || 40));
  const identidad = datos.get("mostrar_identidad_docente") === "on" ? "si" : "no";
  await conDb(async (sql) => {
    for (const [clave, valor] of [["institucion", institucion], ["capacidad_semanal", String(capacidad)], ["mostrar_identidad_docente", identidad]]) {
      await sql`INSERT INTO configuracion (clave, valor) VALUES (${clave}, ${valor})
                ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`;
    }
  });
  revalidatePath("/", "layout");
  return { ok: "Configuración guardada." };
}

const ESTADOS = ["PENDIENTE", "CONTACTADO", "EN_ACOMPANAMIENTO", "CERRADO"];

export async function guardarSeguimiento(_: Estado, datos: FormData): Promise<Estado> {
  const u = await exigirUsuario();
  const id = Number(datos.get("id"));
  const estado = String(datos.get("estado") ?? "");
  const nota = String(datos.get("nota") ?? "").trim().slice(0, 1000);
  if (!ESTADOS.includes(estado)) return { error: "Estado no válido." };
  await conDb((sql) => sql`UPDATE alertas SET estado_seguimiento = ${estado}, nota_seguimiento = ${nota || null},
                             seguimiento_por = ${u.usuario}, seguimiento_en = now() WHERE id = ${id}`);
  revalidatePath("/resultados");
  return { ok: "Seguimiento guardado." };
}
