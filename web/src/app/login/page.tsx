import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { usuarioActual } from "@/lib/sesion";
import { FormularioAcceso } from "./FormularioAcceso";

export const dynamic = "force-dynamic";

export default async function Login() {
  if (await usuarioActual()) redirect("/dashboard");
  return (
    <main className="acceso">
      <div className="tarjeta">
        <div className="marca" style={{ padding: 0 }}>
          <Logo /> Alertas Académicas
        </div>
        <h1>Iniciar sesión</h1>
        <p className="sub">Sistema de alertas tempranas para estudiantes de primer nivel.</p>
        <FormularioAcceso />
      </div>
    </main>
  );
}
