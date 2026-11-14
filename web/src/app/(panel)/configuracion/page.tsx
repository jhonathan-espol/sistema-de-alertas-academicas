import { FormularioClave } from "@/components/FormularioClave";
import { conDb } from "@/lib/db";
import { leerConfig, listarPeriodos, fecha } from "@/lib/datos";
import { exigirUsuario } from "@/lib/sesion";
import { FormularioConfig } from "./FormularioConfig";

export default async function Configuracion() {
  const u = await exigirUsuario();
  const { config, periodos } = await conDb(async (sql) => ({ config: await leerConfig(sql), periodos: await listarPeriodos(sql) }));
  const admin = u.rol === "ADMINISTRADOR";
  return (
    <>
      <header className="cabecera"><div><h1>Configuración</h1><p>Tu cuenta, parámetros del sistema y protocolo de uso</p></div></header>
      <div className="contenido">
        <div className="grid g-2">
          <section className="tarjeta">
            <div className="tarjeta-cab"><div><h2>Mi contraseña</h2><div className="sub">Sesión iniciada como {u.usuario} ({admin ? "Administrador" : "Docente"})</div></div></div>
            <FormularioClave />
          </section>

          <section className="tarjeta">
            <div className="tarjeta-cab"><div><h2>Parámetros del sistema</h2><div className="sub">{admin ? "Se aplican a todos los usuarios" : "Solo el administrador puede modificarlos"}</div></div></div>
            <FormularioConfig editable={admin} valores={{
              institucion: config.institucion ?? "", capacidad_semanal: config.capacidad_semanal ?? "40",
              mostrar_identidad_docente: config.mostrar_identidad_docente === "si",
            }} />
          </section>
        </div>

        <section className="tarjeta">
          <div className="tarjeta-cab"><div><h2>Periodos cargados</h2><div className="sub">Los umbrales de riesgo se fijan en el entrenamiento y no se ajustan a mano</div></div></div>
          <div className="tabla-scroll"><table>
            <thead><tr><th>Periodo</th><th>Estado</th><th>Uso en el modelo</th><th>Inicio de clases (primer nivel)</th><th>Datos hasta</th><th>Modelo aplicado</th></tr></thead>
            <tbody>
              {periodos.map((p) => (
                <tr key={p.periodo}><td style={{ fontWeight: 600 }}>{p.periodo}</td>
                  <td><span className={`chip ${p.estado === "EN_CURSO" ? "info" : "neutro"}`}>{p.estado === "EN_CURSO" ? "En curso" : "Cerrado"}</span></td>
                  <td>{{ ENTRENAMIENTO: "Entrenamiento", PRUEBA: "Prueba retrospectiva", COHORTE_ACTUAL: "Cohorte actual" }[p.rol_modelo] ?? "—"}</td>
                  <td>{fecha(p.inicio_primer_nivel)}</td><td>{fecha(p.ultimo_dato)}{p.estado === "EN_CURSO" ? ` (día ${p.dias_observados})` : ""}</td><td className="sub">{p.modelo ?? "—"}</td></tr>
              ))}
              {!periodos.length && <tr><td colSpan={6} className="sub">Aún no hay periodos cargados.</td></tr>}
            </tbody>
          </table></div>
        </section>

        <section className="tarjeta">
          <div className="tarjeta-cab"><div><h2>Protocolo de uso responsable</h2><div className="sub">Las alertas apoyan la decisión humana; no la reemplazan</div></div></div>
          <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
            <li><b>Finalidad única: acompañar.</b> La alerta sirve para ofrecer tutoría y apoyo de bienestar estudiantil. No se usa para sancionar, negar matrícula, becas o cupos, ni para calificar.</li>
            <li><b>Decide una persona.</b> Ninguna acción se toma solo por el puntaje. El tutor o el personal de bienestar verifica la situación con el estudiante y el docente antes de intervenir.</li>
            <li><b>La alerta es una probabilidad, no un diagnóstico.</b> Habrá estudiantes alertados que no lo necesitan y estudiantes en riesgo que el modelo no detecta; un nivel bajo no descarta que alguien necesite ayuda.</li>
            <li><b>Explicación visible.</b> Cada alerta muestra los factores que la elevan, para que quien atiende sepa por qué aparece el estudiante. Importancia no es causa.</li>
            <li><b>Privacidad.</b> Acceso solo con cuenta personal; la identidad se muestra a quien la necesita para acompañar. No se comparte la lista ni el nivel de riesgo con otros estudiantes ni se etiqueta a nadie como “desertor”.</li>
            <li><b>Equidad.</b> En cada reentrenamiento se revisa la tasa de falsos negativos por sexo, nivel socioeconómico, jornada, zona, edad y situación laboral. Si un grupo queda sistemáticamente desatendido, se corrige antes de usar el modelo.</li>
            <li><b>Registro y revisión.</b> Toda gestión se anota en el seguimiento. Al cierre de cada periodo se contrasta la alerta con el desenlace real y se reentrena el modelo.</li>
            <li><b>Derecho a no ser perjudicado.</b> El estudiante puede pedir que se revise su caso; la información del modelo nunca se usa en su contra.</li>
          </ol>
        </section>
      </div>
    </>
  );
}
