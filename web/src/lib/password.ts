// PBKDF2-HMAC-SHA256 con WebCrypto: funciona igual en Node y en Cloudflare Workers,
// y es compatible con ml/seguridad.py (formato: pbkdf2_sha256$iteraciones$sal$hash).
const ITERACIONES = 100_000; // máximo permitido por WebCrypto en Workers

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const deB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derivar(password: string, sal: Uint8Array, iteraciones: number) {
  const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sal as BufferSource, iterations: iteraciones }, clave, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2_sha256$${ITERACIONES}$${b64(sal)}$${b64(await derivar(password, sal, ITERACIONES))}`;
}

export async function verificarPassword(password: string, guardado: string) {
  const [alg, it, sal, hash] = guardado.split("$");
  if (alg !== "pbkdf2_sha256" || !it || !sal || !hash) return false;
  const calc = await derivar(password, deB64(sal), Number(it));
  const esperado = deB64(hash);
  if (calc.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < calc.length; i++) dif |= calc[i] ^ esperado[i];
  return dif === 0;
}

export function validarPassword(p: string): string | null {
  if (p.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  if (!/[a-zA-Z]/.test(p) || !/\d/.test(p)) return "La contraseña debe combinar letras y números.";
  return null;
}
