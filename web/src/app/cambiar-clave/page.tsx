import { Logo } from "@/components/Logo";
import { exigirUsuario } from "@/lib/sesion";
import { FormularioClave } from "@/components/FormularioClave";

export const dynamic = "force-dynamic";

export default async function CambiarClave() {
  const u = await exigirUsuario();
  return (
    <main className="acceso">
      <div className="tarjeta">
        <div className="marca" style={{ padding: 0 }}><Logo /> Alertas Académicas</div>
        <h1>Define tu contraseña</h1>
        <p className="sub">
          Hola, {u.nombre}. Tu contraseña actual es temporal; cámbiala para continuar.
        </p>
        <div style={{ marginTop: 20 }}><FormularioClave destino="/dashboard" /></div>
      </div>
    </main>
  );
}
