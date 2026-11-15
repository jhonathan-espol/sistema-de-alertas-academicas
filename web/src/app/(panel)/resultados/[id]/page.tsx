import Link from "next/link";
import { notFound } from "next/navigation";
import { Seguimiento } from "@/components/Seguimiento";
import { conDb } from "@/lib/db";
import { TEXTO_NIVEL, TEXTO_VIA, fecha, leerConfig, pct, prob, puedeVerIdentidad } from "@/lib/datos";
import { exigirUsuario } from "@/lib/sesion";

const titulo = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const h = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const p1 = (v: number | null) => (v === null ? "—" : `${v.toFixed(1).replace(".", ",")} %`);

type Asignatura = { codigo: string; nombre: string; clases: number; horas: number; asistidas: number; ausentes: number; pct: number | null };
type Semana = { semana: number; dia_desde: number; dia_hasta: number; horas: number; ausentes: number; pct: number | null };
type Clase = { fecha: string; dia: number; semana: number; codigo: string; horas: number; asistidas: number };
type Detalle = {
  total: { horas: number; asistidas: number; ausentes: number; pct: number | null; dias_con_clase: number; dias_asistidos: number };
  asignaturas: Asignatura[]; semanas: Semana[]; clases: Clase[];
};
type Factor = { etiqueta: string; valor: string; aporte: number };

/** Detalle de un estudiante: de dónde sale cada porcentaje de su alerta (por asignatura, por semana y clase por clase). */
export default async function DetalleEstudiante({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await exigirUsuario();
  if (!/^\d+$/.test(id)) notFound();
  const d = await conDb(async (sql) => {
    const [a] = await sql`
      SELECT id, periodo, id_estudiante, identificacion, nombre, carrera, paralelo, jornada, estado_periodo, grupo, motivo_deteccion,
             nivel_riesgo, probabilidad::float, alerta_linea_base, modelo, factores, fecha_inicio_clases::text ini, fecha_corte::text corte,
             dias_observados, pct_inasistencia_d28::float inasist, max_pct_inasistencia_asig_d28::float inasist_max,
             prop_entregadas_d28::float entregas, via_salida, estado_seguimiento, nota_seguimiento, seguimiento_por,
             seguimiento_en::text, detalle_asistencia
      FROM alertas WHERE id = ${Number(id)}`;
    return a ? { a, config: await leerConfig(sql) } : null;
  });
  if (!d) notFound();
  const { a } = d;
  const verIdentidad = puedeVerIdentidad(d.config, u.rol);
  const nombre = verIdentidad && a.nombre ? titulo(a.nombre) : a.id_estudiante;
  const det = a.detalle_asistencia as Detalle | null;
  const cerrado = a.estado_periodo === "CERRADO";
  const factores = (a.factores ?? []) as Factor[];
  const critica = det ? [...det.asignaturas].sort((x, y) => (y.pct ?? 0) - (x.pct ?? 0))[0] : null;
  const sobreLimite = det ? det.asignaturas.filter((x) => (x.pct ?? 0) > 30).length : 0;
  const s12 = det?.semanas.filter((s) => s.semana <= 2) ?? [], s34 = det?.semanas.filter((s) => s.semana >= 3) ?? [];
  // igual que el pipeline: promedio de los porcentajes semanales (calculados sin redondear)
  const media = (ss: Semana[]) => (ss.length ? ss.reduce((t, s) => t + (s.horas ? (100 * s.ausentes) / s.horas : 0), 0) / ss.length : null);
  const nombreAsig = Object.fromEntries((det?.asignaturas ?? []).map((x) => [x.codigo, x.nombre]));

  return (
    <>
      <header className="cabecera">
        <div>
          <p style={{ marginBottom: 4 }}><Link href={`/resultados?periodo=${a.periodo}`} style={{ color: "var(--azul)", fontWeight: 600 }}>← Volver a Resultados</Link></p>
          <h1>{nombre}</h1>
          <p>
            {verIdentidad && a.identificacion ? `${a.identificacion} · ` : ""}{titulo(a.carrera ?? "")} · paralelo {a.paralelo} · {titulo(a.jornada ?? "")} · periodo {a.periodo}
          </p>
        </div>
        <Seguimiento id={Number(a.id)} estado={a.estado_seguimiento} nota={a.nota_seguimiento} titulo={`${nombre} · ${titulo(a.carrera ?? "")}`}
          quien={a.seguimiento_por ? `${a.seguimiento_por}, ${fecha(a.seguimiento_en)}` : null} />
      </header>

      <div className="contenido">
        <div className="grid g-4">
          <section className="tarjeta"><div className="kpi">
            <div className="rotulo">Nivel de riesgo</div>
            <div className="valor" style={{ fontSize: 20 }}><span className={`chip ${a.nivel_riesgo}`}>{TEXTO_NIVEL[a.nivel_riesgo]}</span></div>
            <div className="nota" style={{ maxWidth: "none" }}>
              {a.grupo === "PREDICCION" ? `Probabilidad estimada: ${prob(a.probabilidad)}` : a.motivo_deteccion}
              {cerrado && a.via_salida ? ` · Desenlace real: ${TEXTO_VIA[a.via_salida] ?? a.via_salida}` : ""}
            </div>
          </div></section>
          <section className="tarjeta"><div className="kpi">
            <div className="rotulo">Inasistencia acumulada</div>
            <div className="valor num">{pct(a.inasist)}</div>
            <div className="nota" style={{ maxWidth: "none" }}>{det ? `${h(det.total.ausentes)} horas ausente de ${h(det.total.horas)} dictadas` : "Sin registros de asistencia"}</div>
          </div></section>
          <section className="tarjeta"><div className="kpi">
            <div className="rotulo">Asignatura más crítica</div>
            <div className="valor num">{pct(a.inasist_max)}</div>
            <div className="nota" style={{ maxWidth: "none" }}>{critica ? `${critica.nombre} · ${sobreLimite} de ${det!.asignaturas.length} asignaturas sobre el 30 %` : "—"}</div>
          </div></section>
          <section className="tarjeta"><div className="kpi">
            <div className="rotulo">Días asistidos</div>
            <div className="valor num">{det ? `${det.total.dias_asistidos} de ${det.total.dias_con_clase}` : "—"}</div>
            <div className="nota" style={{ maxWidth: "none" }}>Ventana: {fecha(a.ini)} al {fecha(a.corte)} (día {a.dias_observados ?? "—"} de 28)</div>
          </div></section>
        </div>

        {!det && (
          <div className="aviso info">
            No hay registros de asistencia de este estudiante dentro de la ventana{a.grupo === "DETECCION_RETIRO" ? " (los estudiantes retirados no constan en los registros de asistencia de SIGA)" : ""}.
            Si acabas de actualizar la aplicación, vuelve a ejecutar <code>python -m ml.pipeline</code> para generar el detalle.
          </div>
        )}

        {det && (
          <>
            <div className="grid g-21">
              <section className="tarjeta">
                <div className="tarjeta-cab"><div><h2>Por asignatura</h2><div className="sub">Horas dictadas y asistidas dentro de la ventana observada</div></div></div>
                <div className="tabla-scroll"><table>
                  <thead><tr><th>Asignatura</th><th className="d">Clases</th><th className="d">Horas dictadas</th><th className="d">Horas asistidas</th><th className="d">Horas ausente</th><th className="d">Inasistencia</th></tr></thead>
                  <tbody>
                    {det.asignaturas.map((x) => (
                      <tr key={x.codigo}>
                        <td>{x.nombre}<div className="sub">{x.codigo}</div></td>
                        <td className="d num">{x.clases}</td><td className="d num">{h(x.horas)}</td><td className="d num">{h(x.asistidas)}</td><td className="d num">{h(x.ausentes)}</td>
                        <td className="d num"><span className={`chip ${(x.pct ?? 0) > 30 ? "ALTO" : (x.pct ?? 0) > 0 ? "MEDIO" : "BAJO"}`}>{p1(x.pct)}</span></td>
                      </tr>
                    ))}
                    <tr style={{ fontWeight: 700 }}>
                      <td>Total</td><td className="d num">{det.clases.length}</td><td className="d num">{h(det.total.horas)}</td><td className="d num">{h(det.total.asistidas)}</td>
                      <td className="d num">{h(det.total.ausentes)}</td><td className="d num">{p1(det.total.pct)}</td>
                    </tr>
                  </tbody>
                </table></div>
              </section>

              <section className="tarjeta">
                <div className="tarjeta-cab"><div><h2>Por semana</h2><div className="sub">Días contados desde la primera clase de su grupo</div></div></div>
                <table>
                  <thead><tr><th>Semana</th><th>Días</th><th className="d">Horas</th><th className="d">Ausente</th><th className="d">Inasistencia</th></tr></thead>
                  <tbody>
                    {det.semanas.map((s) => (
                      <tr key={s.semana}><td>{s.semana}</td><td className="sub">{s.dia_desde} a {s.dia_hasta}</td><td className="d num">{h(s.horas)}</td><td className="d num">{h(s.ausentes)}</td><td className="d num">{p1(s.pct)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>

            <section className="tarjeta">
              <div className="tarjeta-cab"><div><h2>De dónde sale cada porcentaje</h2><div className="sub">Los mismos cálculos que usa el modelo, con las cifras de este estudiante</div></div></div>
              <table><tbody>
                <tr><td style={{ fontWeight: 600, width: 300 }}>Inasistencia acumulada</td><td className="d num" style={{ width: 90 }}>{p1(det.total.pct)}</td>
                  <td>{h(det.total.ausentes)} horas ausente ÷ {h(det.total.horas)} horas dictadas en todas sus asignaturas.</td></tr>
                {critica && (
                  <tr><td style={{ fontWeight: 600 }}>Inasistencia en su asignatura más crítica</td><td className="d num">{p1(critica.pct)}</td>
                    <td>{critica.nombre}: {h(critica.ausentes)} horas ausente ÷ {h(critica.horas)} dictadas ({critica.clases} clases).</td></tr>
                )}
                <tr><td style={{ fontWeight: 600 }}>Inasistencia en semanas 1-2</td><td className="d num">{p1(media(s12))}</td>
                  <td>{s12.length ? `Promedio de ${s12.map((s) => `semana ${s.semana}: ${p1(s.pct)}`).join(" y ")}.` : "Aún no hay clases en estas semanas."}</td></tr>
                <tr><td style={{ fontWeight: 600 }}>Inasistencia en semanas 3-4</td><td className="d num">{p1(media(s34))}</td>
                  <td>{s34.length ? `Promedio de ${s34.map((s) => `semana ${s.semana}: ${p1(s.pct)}`).join(" y ")}.${s34.length === 1 && !cerrado ? " La semana 4 todavía no tiene clases registradas." : ""}` : "Aún no hay clases en estas semanas."}</td></tr>
                <tr><td style={{ fontWeight: 600 }}>Asignaturas sobre el 30 % de inasistencia</td><td className="d num">{sobreLimite} de {det.asignaturas.length}</td>
                  <td>{sobreLimite ? det.asignaturas.filter((x) => (x.pct ?? 0) > 30).map((x) => `${x.nombre} (${p1(x.pct)})`).join(", ") + "." : "Ninguna."} El 30 % es el límite reglamentario al cierre del periodo; aquí se mide sobre las horas dictadas hasta la fecha.</td></tr>
              </tbody></table>
              {a.grupo === "PREDICCION" && (
                <p className="sub" style={{ marginTop: 10 }}>
                  La probabilidad ({prob(a.probabilidad)}) no es una operación sobre estas cifras: la estima el modelo ({a.modelo ?? "sin modelo"}) combinándolas.
                  {factores.length ? ` Los factores que más la elevan son: ${factores.map((f) => `${f.etiqueta.toLowerCase()} (${f.valor})`).join("; ")}.` : ""}
                </p>
              )}
            </section>

            <section className="tarjeta">
              <div className="tarjeta-cab"><div><h2>Clase por clase</h2><div className="sub">{det.clases.length} clases registradas en SIGA dentro de la ventana</div></div></div>
              <div className="tabla-scroll"><table>
                <thead><tr><th>Fecha</th><th className="d">Día</th><th className="d">Semana</th><th>Asignatura</th><th className="d">Horas dictadas</th><th className="d">Horas asistidas</th><th>Registro</th></tr></thead>
                <tbody>
                  {det.clases.map((c, k) => (
                    <tr key={k}>
                      <td className="nw">{fecha(c.fecha)}</td><td className="d num">{c.dia}</td><td className="d num">{c.semana}</td><td>{nombreAsig[c.codigo] ?? c.codigo}</td>
                      <td className="d num">{h(c.horas)}</td><td className="d num">{h(c.asistidas)}</td>
                      <td>{c.asistidas >= c.horas ? <span className="chip BAJO">Asistió</span> : c.asistidas > 0 ? <span className="chip MEDIO">Parcial</span> : <span className="chip ALTO">Faltó</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </section>
          </>
        )}

        <div className="aviso info">
          <b>Uso responsable.</b> Este detalle sirve para preparar la conversación con el estudiante, no para juzgarlo. Faltas concentradas en ciertas materias o franjas
          pueden deberse a un cruce de horario, trabajo o transporte: confírmalo con el estudiante y registra el seguimiento.
        </div>
      </div>
    </>
  );
}
