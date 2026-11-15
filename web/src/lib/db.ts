import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import postgres from "postgres";

export type Sql = postgres.Sql;

const enWorkers = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

/**
 * Cadena de conexión:
 * - En Cloudflare se usa Hyperdrive (binding HYPERDRIVE de wrangler.jsonc). Hyperdrive mantiene las
 *   conexiones con Supabase y el Worker le habla por un canal interno sin TLS; conectar directamente
 *   desde el Worker al pooler de Supabase no funciona (su certificado no es de una autoridad pública).
 * - En local (Node) se usa DATABASE_URL del archivo .env.
 */
function destino(): { url: string; sinTls: boolean } {
  if (enWorkers) {
    const env = getCloudflareContext().env as { HYPERDRIVE?: { connectionString: string } };
    if (!env.HYPERDRIVE?.connectionString) throw new Error("Falta el binding HYPERDRIVE en el Worker");
    return { url: env.HYPERDRIVE.connectionString, sinTls: true };
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta la variable DATABASE_URL");
  return { url, sinTls: /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url) };
}

function crear(): Sql {
  const { url, sinTls } = destino();
  return postgres(url, {
    max: enWorkers ? 1 : 5,
    prepare: false, // compatible con los poolers en modo transacción
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: sinTls ? false : "require",
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
