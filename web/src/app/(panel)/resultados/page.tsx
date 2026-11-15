import Link from "next/link";
import { Filtros } from "@/components/Filtros";
import { Seguimiento } from "@/components/Seguimiento";
import { conDb } from "@/lib/db";
import { TEXTO_NIVEL, TEXTO_VIA, elegirPeriodo, fecha, leerConfig, listarPeriodos, pct, prob, puedeVerIdentidad } from "@/lib/datos";
import { exigirUsuario } from "@/lib/sesion";

const POR_PAGINA = 25;
const titulo = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
type Factor = { etiqueta: string; valor: string; aporte: number };

export default async function Resultados({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await exigirUsuario();
  const pagina = Math.max(1, Number(sp.pagina) || 1);
  const d = await conDb(async (sql) => {
    const periodos = await listarPeriodos(sql);
    if (!periodos.length) return null;
    const per = elegirPeriodo(periodos, sp.periodo);
    const carrera = sp.carrera ?? "", nivel = sp.nivel ?? "", q = (sp.q ?? "").trim();
    const config = await leerConfig(sql);
    const verIdentidad = puedeVerIdentidad(config, u.rol);
    const patron = `%${q}%`;
    const f = sql`periodo = ${per.periodo} AND (${carrera} = '' OR carrera = ${carrera}) AND (${nivel} = '' OR nivel_riesgo = ${nivel})
                  AND (${q} = '' OR carrera ILIKE ${patron} OR id_estudiante ILIKE ${patron}
                       OR (${verIdentidad} AND (nombre ILIKE ${patron} OR identificacion ILIKE ${patron})))`;
    const [carreras, filas, cuenta, matriz] = await Promise.all([
      sql`SELECT DISTINCT carrera FROM alertas WHERE periodo = ${per.periodo} ORDER BY 1`,
      sql`SELECT id, id_estudiante, identificacion, nombre, carrera, paralelo, jornada, grupo, motivo_deteccion, nivel_riesgo,
                 probabilidad::float, alerta_linea_base, factores, pct_inasistencia_d28::float inasist,
                 max_pct_inasistencia_asig_d28::float inasist_max, prop_entregadas_d28::float entregas, via_salida,
                 reprobo_inasistencias, estado_seguimiento, nota_seguimiento, seguimiento_por, seguimiento_en::text
          FROM alertas WHERE ${f}
          ORDER BY (nivel_riesgo = 'DETECTADO') DESC, puntaje DESC NULLS LAST, id
          LIMIT ${POR_PAGINA} OFFSET ${(pagina - 1) * POR_PAGINA}`,
      sql`SELECT count(*)::int n FROM alertas WHERE ${f}`,
      sql`SELECT nivel_riesgo, count(*)::int n, count(*) FILTER (WHERE reprobo_inasistencias)::int positivos,
                 count(*) FILTER (WHERE alerta_linea_base)::int base
          FROM alertas WHERE periodo = ${per.periodo} AND grupo = 'PREDICCION' GROUP BY 1`,
    ]);
    return { periodos, per, carrera, nivel, q, carreras, filas, total: cuenta[0].n, matriz, verIdentidad };
  });

  if (!d) return (<><header className="cabecera"><div><h1>Resultados</h1><p>Aún no hay datos cargados</p></div></header></>);
  const { per } = d;
  const cerrado = per.estado === "CERRADO";
  const m = Object.fromEntries(d.matriz.map((x) => [x.nivel_riesgo, x])) as Record<string, { n: number; positivos: number; base: number }>;
  const totPos = d.matriz.reduce((s, x) => s + x.positivos, 0);
  const paginas = Math.max(1, Math.ceil(d.total / POR_PAGINA));
  const enlace = (p: number) => {
    const qs = new URLSearchParams(Object.entries({ periodo: per.periodo, carrera: d.carrera, nivel: d.nivel, q: d.q, pagina: String(p) }).filter(([, v]) => v));
    return `/resultados?${qs}`;
  };

  return (
    <>
      <header className="cabecera">
        <div>
          <h1>Resultados</h1>
          <p>Alertas por estudiante · periodo {per.periodo}{d.q ? ` · búsqueda: “${d.q}”` : ""}</p>
        </div>
        <Filtros campos={[
          { nombre: "periodo", rotulo: "Periodo", valor: per.periodo, opciones: d.periodos.map((p) => ({ valor: p.periodo, texto: `${p.periodo}${p.estado === "EN_CURSO" ? " (en curso)" : ""}` })) },
          { nombre: "carrera", rotulo: "Carrera", valor: d.carrera, opciones: [{ valor: "", texto: "Todas" }, ...d.carreras.map((c) => ({ valor: c.carrera, texto: titulo(c.carrera) }))] },
          { nombre: "nivel", rotulo: "Nivel de riesgo", valor: d.nivel, opciones: [{ valor: "", texto: "Todos" }, ...["DETECTADO", "ALTO", "MEDIO", "BAJO"].map((k) => ({ valor: k, texto: TEXTO_NIVEL[k] }))] },
        ]} />
      </header>

      <div className="contenido">
        {!cerrado && (per.dias_observados ?? 0) < 28 && (
          <div className="aviso alerta"><b>Ventana parcial: día {per.dias_observados} de 28</b> (datos hasta el {fecha(per.ultimo_dato)}). Los niveles son preliminares.</div>
        )}

        <div className="grid g-4">
          {["ALTO", "MEDIO", "BAJO"].map((k) => (
            <section className="tarjeta" key={k}>
              <div className="kpi">
                <div className="rotulo"><span className={`chip ${k}`}>{TEXTO_NIVEL[k]}</span></div>
                <div className="valor num">{m[k]?.n ?? 0}</div>
                <div className="nota" style={{ maxWidth: "none" }}>
                  {cerrado
                    ? `${m[k]?.positivos ?? 0} reprobaron por inasistencias (${m[k]?.n ? ((100 * m[k].positivos) / m[k].n).toFixed(0) : 0} %)`
                    : k === "ALTO" ? "Contactar primero" : k === "MEDIO" ? "Monitorear cada semana" : "Seguimiento habitual"}
                </div>
              </div>
            </section>
          ))}
          <section className="tarjeta">
            <div className="kpi">
              <div className="rotulo">{cerrado ? "Sensibilidad en este periodo" : "Modelo aplicado"}</div>
              {cerrado ? (
                <>
                  <div className="valor num">{totPos ? pct((100 * (m.ALTO?.positivos ?? 0)) / totPos, 0) : "—"}</div>
                  <div className="nota" style={{ maxWidth: "none" }}>de los {totPos} que reprobaron por inasistencias estaban en riesgo alto (predicción fuera de periodo)</div>
                </>
              ) : (<div className="nota" style={{ maxWidth: "none", marginTop: 6 }}>{per.modelo}</div>)}
            </div>
          </section>
        </div>

        <section className="tarjeta">
          <div className="tarjeta-cab">
            <div><h2>Estudiantes</h2><div className="sub">{d.total} registros · ordenados por prioridad de atención</div></div>
            {!d.verIdentidad && <span className="chip neutro">Identidad seudonimizada</span>}
          </div>
          <div className="tabla-scroll">
            <table>
              <thead>
                <tr><th>Estudiante</th><th>Carrera</th><th>Nivel</th><th className="d">Prob.</th><th className="d">Inasist.</th><th>Por qué aparece</th>
                  {cerrado && <th>Desenlace real</th>}<th>Línea base</th><th>Seguimiento</th></tr>
              </thead>
              <tbody>
                {d.filas.map((r) => {
                  const nombre = d.verIdentidad && r.nombre ? titulo(r.nombre) : r.id_estudiante;
                  return (
                    <tr key={r.id}>
                      <td><div style={{ fontWeight: 600 }}>{nombre}</div><div className="sub">{d.verIdentidad && r.identificacion ? r.identificacion : r.id_estudiante}</div></td>
                      <td>{titulo(r.carrera ?? "")}<div className="sub">{r.paralelo} · {titulo(r.jornada ?? "")}</div></td>
                      <td><span className={`chip ${r.nivel_riesgo}`}>{TEXTO_NIVEL[r.nivel_riesgo]}</span></td>
                      <td className="d num">{prob(r.probabilidad)}</td>
                      <td className="d num">{pct(r.inasist, 0)}<div className="sub">máx. {pct(r.inasist_max, 0)}</div></td>
                      <td style={{ minWidth: 240 }}>
                        {r.grupo !== "PREDICCION" ? <span>{r.motivo_deteccion}</span> : (
                          <div className="factores">
                            {(r.factores as Factor[]).length
                              ? (r.factores as Factor[]).map((f) => <span key={f.etiqueta}>{f.etiqueta}: <b>{f.valor}</b></span>)
                              : <span>Sin factores que eleven el riesgo</span>}
                          </div>
                        )}
                      </td>
                      {cerrado && <td><span className={`chip ${r.reprobo_inasistencias ? "no" : r.via_salida === "RETIRO_VOLUNTARIO" ? "DETECTADO" : "neutro"}`}>{TEXTO_VIA[r.via_salida] ?? "—"}</span></td>}
                      <td>{r.alerta_linea_base === null ? "—" : r.alerta_linea_base ? <span className="chip info">Alerta</span> : <span className="sub">Sin alerta</span>}</td>
                      <td><Seguimiento id={Number(r.id)} estado={r.estado_seguimiento} nota={r.nota_seguimiento} titulo={`${nombre} · ${titulo(r.carrera ?? "")}`}
                        quien={r.seguimiento_por ? `${r.seguimiento_por}, ${fecha(r.seguimiento_en)}` : null} /></td>
                    </tr>
                  );
                })}
                {!d.filas.length && <tr><td colSpan={9} className="sub">No hay estudiantes con estos filtros.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="paginas">
            <span>Página {pagina} de {paginas}</span>
            {pagina > 1 && <Link className="btn btn-mini" href={enlace(pagina - 1)}>Anterior</Link>}
            {pagina < paginas && <Link className="btn btn-mini" href={enlace(pagina + 1)}>Siguiente</Link>}
          </div>
        </section>

        <div className="aviso info">
          <b>Uso responsable.</b> La alerta es una señal para ofrecer acompañamiento, no un juicio sobre el estudiante ni una decisión automática.
          Antes de actuar, verifica la situación con el docente tutor y registra el seguimiento. “Línea base” indica si la regla simple de inasistencia también habría alertado.
        </div>
      </div>
    </>
  );
}
