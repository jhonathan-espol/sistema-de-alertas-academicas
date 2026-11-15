import type { NextConfig } from "next";

// Variables de entorno:
//  - Local: los scripts "dev" y "start" cargan el archivo .env de la raíz del proyecto
//    (el mismo que usa Python) con `node --env-file-if-exists=../.env`.
//  - Cloudflare: DATABASE_URL y AUTH_SECRET llegan como "secrets" del Worker.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // El cliente de PostgreSQL publica una variante propia para Cloudflare Workers ("workerd").
  // Si Next lo empaqueta, queda la variante de Node y la conexión cifrada no se abre en producción;
  // al dejarlo externo, OpenNext lo resuelve con la variante correcta.
  serverExternalPackages: ["postgres"],};

export default nextConfig;
