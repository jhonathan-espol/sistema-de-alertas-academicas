import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { conDb } from "./db";

const COOKIE = "saa_sesion";
const HORAS = 8;

export type Usuario = {
  id: number;
  usuario: string;
  nombre: string;
  rol: "ADMINISTRADOR" | "DOCENTE";
  debe_cambiar_password: boolean;
};

function secreto() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("Falta AUTH_SECRET (mínimo 32 caracteres)");
  return new TextEncoder().encode(s);
}

export async function abrirSesion(id: number) {
  const token = await new SignJWT({ uid: id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${HORAS}h`)
    .sign(secreto());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: HORAS * 3600,
  });
}

export async function cerrarSesion() {
  (await cookies()).delete(COOKIE);
}

/** Usuario de la sesión, validado contra la base en cada petición (un usuario desactivado pierde el acceso de inmediato). */
export const usuarioActual = cache(async (): Promise<Usuario | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  let uid: number;
  try {
    const { payload } = await jwtVerify(token, secreto(), { algorithms: ["HS256"] });
    uid = Number(payload.uid);
  } catch {
    return null;
  }
  const filas = await conDb(
    (sql) => sql<Usuario[]>`SELECT id, usuario, nombre, rol, debe_cambiar_password FROM usuarios WHERE id = ${uid} AND activo`,
  );
  return filas[0] ? { ...filas[0], id: Number(filas[0].id) } : null;
});

export async function exigirUsuario(): Promise<Usuario> {
  const u = await usuarioActual();
  if (!u) redirect("/login");
  return u;
}

export async function exigirAdmin(): Promise<Usuario> {
  const u = await exigirUsuario();
  if (u.rol !== "ADMINISTRADOR") redirect("/dashboard");
  return u;
}
