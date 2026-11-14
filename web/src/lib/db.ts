import "server-only";
import postgres from "postgres";

export type Sql = postgres.Sql;

const enWorkers = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

function crear(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta la variable DATABASE_URL");
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
  return postgres(url, {
    max: enWorkers ? 1 : 5,
    prepare: false, // obligatorio con el pooler de Supabase en modo transacción (puerto 6543)
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: local ? false : "require",
    onnotice: () => {},
  });
}

const g = globalThis as unknown as { __sql?: Sql };

/**
 * Ejecuta consultas contra PostgreSQL.
 * - En Node (local) reutiliza un pool global.
 * - En Cloudflare Workers abre una conexión por petición y la cierra al terminar
 *   (los sockets no pueden compartirse entre peticiones).
 */
export async function conDb<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  if (!enWorkers) {
    g.__sql ??= crear();
    return fn(g.__sql);
  }
  const sql = crear();
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}
