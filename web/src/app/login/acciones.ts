"use server";
import { redirect } from "next/navigation";
import { conDb } from "@/lib/db";
import { verificarPassword } from "@/lib/password";
import { abrirSesion, cerrarSesion } from "@/lib/sesion";

type Estado = { error?: string } | null;

export async function iniciarSesion(_: Estado, datos: FormData): Promise<Estado> {
  const usuario = String(datos.get("usuario") ?? "").trim();
  const password = String(datos.get("password") ?? "");
  if (!usuario || !password) return { error: "Ingresa tu usuario y contraseña." };

  let id: number | null = null;
  try {
    id = await conDb(async (sql) => {
      const [u] = await sql`SELECT id, password_hash, activo FROM usuarios WHERE lower(usuario) = lower(${usuario})`;
      if (!u || !u.activo || !(await verificarPassword(password, u.password_hash))) return null;
      await sql`UPDATE usuarios SET ultimo_acceso = now() WHERE id = ${u.id}`;
      return Number(u.id);
    });
  } catch (e) {
    console.error("Error de acceso", e);
    // Se muestra solo el tipo de fallo (nunca la cadena de conexión) para poder diagnosticarlo.
    const x = e as { code?: string; name?: string; message?: string };
    const causa = x?.code ?? (x?.message?.startsWith("Falta") ? x.message : x?.name) ?? "desconocida";
    return { error: `No se pudo conectar con la base de datos (causa: ${causa}).` };
  }
  if (id === null) return { error: "Usuario o contraseña incorrectos." };
  await abrirSesion(id);
  redirect("/dashboard");
}

export async function salir() {
  await cerrarSesion();
  redirect("/login");
}
