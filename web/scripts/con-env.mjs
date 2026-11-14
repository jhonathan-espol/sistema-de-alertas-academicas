// Carga el archivo .env de la raíz del proyecto (el mismo que usa Python) y ejecuta Next.js.
// Uso: node scripts/con-env.mjs dev | start
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ruta = resolve(web, "..", ".env");
if (existsSync(ruta)) {
  for (const linea of readFileSync(ruta, "utf8").split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || linea.trim().startsWith("#")) continue;
    process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
  }
} else {
  console.warn(`No se encontró ${ruta}. Copia .env.example como .env en la raíz del proyecto.`);
}

const next = resolve(web, "node_modules", "next", "dist", "bin", "next");
const hijo = spawn(process.execPath, [next, ...process.argv.slice(2)], { cwd: web, stdio: "inherit", env: process.env });
hijo.on("exit", (codigo) => process.exit(codigo ?? 0));
