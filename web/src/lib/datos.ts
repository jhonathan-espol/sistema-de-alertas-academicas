import "server-only";
import type { Sql } from "./db";

export type Periodo = {
  periodo: string; estado: "CERRADO" | "EN_CURSO"; rol_modelo: string; inicio_primer_nivel: string | null;
  ultimo_dato: string | null; dias_observados: number | null; modelo: string | null;
};

export async function listarPeriodos(sql: Sql) {
  return sql<Periodo[]>`SELECT periodo, estado, rol_modelo, inicio_primer_nivel::text, ultimo_dato::text, dias_observados, modelo
                        FROM periodos ORDER BY periodo DESC`;
}

/** Periodo elegido en la URL o, por defecto, la cohorte en curso (o la más reciente). */
export function elegirPeriodo(periodos: Periodo[], pedido?: string) {
  return periodos.find((p) => p.periodo === pedido) ?? periodos.find((p) => p.estado === "EN_CURSO") ?? periodos[0];
}

export async function leerConfig(sql: Sql) {
  const filas = await sql`SELECT clave, valor FROM configuracion`;
  return Object.fromEntries(filas.map((f) => [f.clave, f.valor])) as Record<string, string>;
}

export const NIVELES = ["ALTO", "MEDIO", "BAJO", "DETECTADO"] as const;
export const TEXTO_NIVEL: Record<string, string> = {
  ALTO: "Riesgo alto", MEDIO: "Riesgo medio", BAJO: "Riesgo bajo", DETECTADO: "Detectado", SIN_PUNTAJE: "Sin puntaje",
};
export const TEXTO_VIA: Record<string, string> = {
  PERMANECE_APRUEBA: "Aprobó", PERMANECE_REPRUEBA_RENDIMIENTO: "Reprobó por rendimiento",
  REPRUEBA_INASISTENCIAS: "Reprobó por inasistencias", RETIRO_VOLUNTARIO: "Retiro voluntario",
};
export const TEXTO_SEGUIMIENTO: Record<string, string> = {
  PENDIENTE: "Pendiente", CONTACTADO: "Contactado", EN_ACOMPANAMIENTO: "En acompañamiento", CERRADO: "Cerrado",
};

export const fecha = (s: string | null) =>
  s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString("es-EC", { day: "numeric", month: "short", year: "numeric" }) : "—";
/** Probabilidad calibrada para mostrar: los extremos se acotan porque ninguna estimación es una certeza. */
export const prob = (p: number | null | undefined) =>
  p === null || p === undefined ? "—" : p > 0.95 ? "> 95 %" : p < 0.05 ? "< 5 %" : `${(100 * p).toFixed(0)} %`;
export const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(d)} %`);
