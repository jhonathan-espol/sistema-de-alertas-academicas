import { conDb } from "@/lib/db";
import { fecha } from "@/lib/datos";
import { exigirAdmin } from "@/lib/sesion";
import { FilaUsuario, NuevoUsuario } from "./Formularios";

export default async function Usuarios() {
  const yo = await exigirAdmin();
  const usuarios = await conDb((sql) => sql`
    SELECT id, usuario, nombre, rol, activo, debe_cambiar_password, ultimo_acceso::text, creado_en::text FROM usuarios ORDER BY lower(usuario)`);
  return (
    <>
      <header className="cabecera">
        <div><h1>Usuarios</h1><p>Cuentas con acceso al sistema · {usuarios.length} registradas</p></div>
        <NuevoUsuario />
      </header>
      <div className="contenido">
        <section className="tarjeta">
          <div className="tabla-scroll">
            <table>
              <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th>Creado</th><th></th></tr></thead>
              <tbody>
                {usuarios.map((u) => (
                  <FilaUsuario key={u.id} esYo={Number(u.id) === yo.id}
                    u={{ id: Number(u.id), usuario: u.usuario, nombre: u.nombre, rol: u.rol, activo: u.activo, temporal: u.debe_cambiar_password,
                      acceso: u.ultimo_acceso ? fecha(u.ultimo_acceso) : "Nunca", creado: fecha(u.creado_en) }} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <div className="aviso info">
          Las contraseñas se guardan como hash (PBKDF2-SHA256): nadie puede leerlas, ni siquiera el administrador. Al crear una cuenta o restablecer una contraseña,
          el usuario debe definir una propia en su siguiente ingreso.
        </div>
      </div>
    </>
  );
}
