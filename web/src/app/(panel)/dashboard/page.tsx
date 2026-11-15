import Link from "next/link";
import { Filtros } from "@/components/Filtros";
import { BarrasRayadas, Lineas, Medidor, Sankey } from "@/components/graficos";
import { COLOR_NIVEL } from "@/lib/colores";
import { conDb } from "@/lib/db";
import { TEXTO_NIVEL, TEXTO_SEGUIMIENTO, TEXTO_VIA, elegirPeriodo, fecha, leerConfig, listarPeriodos, pct, prob, puedeVerIdentidad } from "@/lib/datos";
import { exigirUsuario } from "@/lib/sesion";

const siglas = (carrera: string) => {
  const limpio = carrera.replace(/^TECNOLOGIA SUPERIOR EN |^TECNICO SUPERIOR EN /, "");
  const palabras = limpio.split(/\s+/).filter((p) => p.length > 2);
  return (palabras.length === 1 ? palabras[0].slice(0, 4) : palabras.map((p) => p[0]).join("").slice(0, 4)).toUpperCase();
};
const titulo = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await exigirUsuario();
  const d = await conDb(async (sql) => {
    const periodos = await listarPeriodos(sql);
    if (!periodos.length) return null;
    const per = elegirPeriodo(periodos, sp.periodo);
    const carrera = sp.carrera ?? "", jornada = sp.jornada ?? "";
    const f = sql`periodo = ${per.periodo} AND (${carrera} = '' OR carrera = ${carrera}) AND (${jornada} = '' OR jornada = ${jornada})`;
    const [config, carreras, jornadas, niveles, flujo1, flujo2, porCarrera, historico, prioridad, anterior] = await Promise.all([
      leerConfig(sql),
      sql`SELECT DISTINCT carrera FROM alertas WHERE periodo = ${per.periodo} ORDER BY 1`,
      sql`SELECT DISTINCT jornada FROM alertas WHERE periodo = ${per.periodo} AND jornada IS NOT NULL ORDER BY 1`,
      sql`SELECT nivel_riesgo, count(*)::int n, avg(pct_inasistencia_d28)::float inasist,
                 count(*) FILTER (WHERE estado_seguimiento <> 'PENDIENTE')::int atendidos FROM alertas WHERE ${f} GROUP BY 1`,
      sql`SELECT coalesce(jornada, 'SIN JORNADA') de, nivel_riesgo a, count(*)::int valor FROM alertas WHERE ${f} GROUP BY 1, 2`,
      sql`SELECT nivel_riesgo de, CASE WHEN estado_periodo = 'CERRADO' THEN coalesce(via_salida, 'SIN_DATO') ELSE estado_seguimiento END a,
                 count(*)::int valor FROM alertas WHERE ${f} GROUP BY 1, 2`,
      sql`SELECT carrera, count(*)::int n, count(*) FILTER (WHERE nivel_riesgo = 'ALTO')::int altos
          FROM alertas WHERE ${f} AND grupo = 'PREDICCION' GROUP BY 1 HAVING count(*) >= 5 ORDER BY 3 DESC, 1 LIMIT 9`,
      sql`SELECT periodo, 100.0 * avg((nivel_riesgo = 'ALTO')::int)::float alto,
                 100.0 * avg(reprobo_inasistencias::int)::float real, avg(pct_inasistencia_d28)::float inasist
          FROM alertas WHERE grupo = 'PREDICCION' GROUP BY 1 ORDER BY 1`,
      sql`SELECT id, id_estudiante, identificacion, nombre, carrera, jornada, nivel_riesgo, probabilidad::float, pct_inasistencia_d28::float inasist,
                 estado_seguimiento, factores FROM alertas WHERE ${f} AND nivel_riesgo IN ('ALTO', 'DETECTADO')
          ORDER BY (nivel_riesgo = 'DETECTADO') DESC, puntaje DESC NULLS LAST LIMIT 7`,
      // periodo anterior con los MISMOS filtros de carrera y jornada (una carrera nueva no tiene con qué compararse)
      sql`SELECT count(*)::int n, count(*) FILTER (WHERE nivel_riesgo = 'ALTO')::int altos,
                 count(*) FILTER (WHERE nivel_riesgo IN ('ALTO', 'MEDIO', 'BAJO'))::int evaluados
          FROM alertas WHERE periodo = (SELECT max(periodo) FROM periodos WHERE periodo < ${per.periodo})
            AND (${carrera} = '' OR carrera = ${carrera}) AND (${jornada} = '' OR jornada = ${jornada})`,
    ]);
    return { periodos, per, carrera, jornada, config, carreras, jornadas, niveles, flujo1, flujo2, porCarrera, historico, prioridad, anterior: anterior[0] };
  });

  if (!d) {
    return (
      <>
        <header className="cabecera"><div><h1>Dashboard</h1><p>Aún no hay datos cargados</p></div></header>
        <div className="contenido"><div className="aviso info">
          Ejecuta el pipeline de datos y modelos (<code>python -m ml.pipeline</code>) para cargar las alertas. Consulta la página <Link href="/entrenamiento"><b>Entrenamiento</b></Link>.
        </div></div>
      </>
    );
  }

  const { per } = d;
  const cerrado = per.estado === "CERRADO";
  const n = Object.fromEntries(d.niveles.map((x) => [x.nivel_riesgo, x.n])) as Record<string, number>;
  const total = d.niveles.reduce((s, x) => s + x.n, 0);
  const evaluados = (n.ALTO ?? 0) + (n.MEDIO ?? 0) + (n.BAJO ?? 0);
  const inasist = d.niveles.reduce((s, x) => s + (x.inasist ?? 0) * x.n, 0) / Math.max(d.niveles.filter((x) => x.inasist !== null).reduce((s, x) => s + x.n, 0), 1);
  const atendidos = d.niveles.filter((x) => ["ALTO", "DETECTADO"].includes(x.nivel_riesgo)).reduce((s, x) => s + x.atendidos, 0);
  const verIdentidad = puedeVerIdentidad(d.config, u.rol);
  const pctAlto = evaluados ? (100 * (n.ALTO ?? 0)) / evaluados : 0;
  const pctAltoAnt = d.anterior?.evaluados ? (100 * d.anterior.altos) / d.anterior.evaluados : null;
  const filtrado = Boolean(d.carrera || d.jornada);
  const parcial = !cerrado && (per.dias_observados ?? 0) < 28;

  const colJornada = [...new Set(d.flujo1.map((x) => x.de as string))].sort().map((j) => ({ id: `j:${j}`, etiqueta: titulo(j), color: "#2563eb" }));
  const colNivel = ["ALTO", "MEDIO", "BAJO", "DETECTADO", "SIN_PUNTAJE"].map((k) => ({ id: `n:${k}`, etiqueta: TEXTO_NIVEL[k], color: COLOR_NIVEL[k] }));
  const colFinal = cerrado
    ? [["REPRUEBA_INASISTENCIAS", "#b91c1c"], ["RETIRO_VOLUNTARIO", "#6d5bd0"], ["PERMANECE_REPRUEBA_RENDIMIENTO", "#8a93a3"], ["PERMANECE_APRUEBA", "#2563eb"]]
        .map(([k, c]) => ({ id: `f:${k}`, etiqueta: TEXTO_VIA[k], color: c }))
    : [["PENDIENTE", "#f59e0b"], ["CONTACTADO", "#2563eb"], ["EN_ACOMPANAMIENTO", "#0d9488"], ["CERRADO", "#8a93a3"]]
        .map(([k, c]) => ({ id: `f:${k}`, etiqueta: TEXTO_SEGUIMIENTO[k], color: c }));

  return (
    <>
      <header className="cabecera">
        <div>
          <h1>Dashboard</h1>
          <p>{d.config.institucion ?? "Alertas tempranas"} · primer nivel presencial · periodo {per.periodo}</p>
        </div>
        <Filtros campos={[
          { nombre: "periodo", rotulo: "Periodo", valor: per.periodo, opciones: d.periodos.map((p) => ({ valor: p.periodo, texto: `${p.periodo}${p.estado === "EN_CURSO" ? " (en curso)" : ""}` })) },
          { nombre: "carrera", rotulo: "Carrera", valor: d.carrera, opciones: [{ valor: "", texto: "Todas" }, ...d.carreras.map((c) => ({ valor: c.carrera, texto: titulo(c.carrera) }))] },
          { nombre: "jornada", rotulo: "Jornada", valor: d.jornada, opciones: [{ valor: "", texto: "Todas" }, ...d.jornadas.map((j) => ({ valor: j.jornada, texto: titulo(j.jornada) }))] },
        ]} />
      </header>

      <div className="contenido">
        {parcial && (
          <div className="aviso alerta">
            <b>Ventana parcial: día {per.dias_observados} de 28.</b> Clases desde el {fecha(per.inicio_primer_nivel)}; último registro de asistencia cargado: {fecha(per.ultimo_dato)}.
            Los niveles de riesgo son preliminares y se consolidan al completar las cuatro semanas.
          </div>
        )}

        <div className="grid g-21">
          <section className="tarjeta">
            <div className="tarjeta-cab">
              <div className="kpis">
                <div className="kpi">
                  <div className="rotulo"><span className="punto" style={{ background: "#2563eb" }} />Estudiantes</div>
                  <div className="valor num">{total}</div>
                  <div className="nota">{evaluados} con estimación de riesgo{d.anterior?.n ? ` · ${d.anterior.n} el periodo anterior` : ""}</div>
                </div>
                <div className="kpi">
                  <div className="rotulo"><span className="punto" style={{ background: COLOR_NIVEL.ALTO }} />Riesgo alto</div>
                  <div className="valor num">{n.ALTO ?? 0}<span className="delta" style={{ color: "#b91c1c" }}>{pct(pctAlto, 0)}</span></div>
                  <div className="nota">{pctAltoAnt !== null ? `Frente a ${pct(pctAltoAnt, 0)} del periodo anterior${filtrado ? " con los mismos filtros" : ""}`
                    : filtrado ? "Sin datos del periodo anterior para estos filtros" : "de los evaluados"}</div>
                </div>
                <div className="kpi">
                  <div className="rotulo"><span className="punto" style={{ background: COLOR_NIVEL.DETECTADO }} />Casos detectados</div>
                  <div className="valor num">{n.DETECTADO ?? 0}</div>
                  <div className="nota">Constatables por regla: retiro o inasistencia irreversible</div>
                </div>
                <div className="kpi">
                  <div className="rotulo"><span className="punto" style={{ background: "#8a93a3" }} />Inasistencia media</div>
                  <div className="valor num">{pct(inasist)}</div>
                  <div className="nota">{cerrado ? "Acumulada al día 28" : `Acumulada al día ${per.dias_observados}`}</div>
                </div>
              </div>
            </div>
            <Sankey columnas={[colJornada, colNivel, colFinal]}
              enlaces={[d.flujo1.map((x) => ({ de: `j:${x.de}`, a: `n:${x.a}`, valor: x.valor })), d.flujo2.map((x) => ({ de: `n:${x.de}`, a: `f:${x.a}`, valor: x.valor }))]} />
            <div className="sub" style={{ marginTop: 6 }}>
              Jornada → nivel de riesgo al día {cerrado ? 28 : per.dias_observados} → {cerrado ? "desenlace real al cierre del periodo" : "estado del seguimiento"}
            </div>
          </section>

          <section className="tarjeta">
            <div className="tarjeta-cab"><div><h2>Riesgo alto por carrera</h2><div className="sub">% de estudiantes de cada carrera en riesgo alto</div></div></div>
            <BarrasRayadas unidad=" %" decimales={0}
              datos={d.porCarrera.map((c) => ({ etiqueta: siglas(c.carrera), valor: (100 * c.altos) / c.n, detalle: `${titulo(c.carrera)} · ${c.altos} de ${c.n}` }))} />
            <div className="kpi" style={{ marginTop: 14 }}>
              <div className="rotulo"><span className="punto" style={{ background: "#2563eb" }} />Atención registrada</div>
              <div className="valor num">{atendidos}<span className="delta" style={{ color: "#5d6370" }}>de {(n.ALTO ?? 0) + (n.DETECTADO ?? 0)}</span></div>
              <div className="nota" style={{ maxWidth: "none" }}>casos de riesgo alto o detectados con seguimiento iniciado</div>
            </div>
          </section>
        </div>

        <div className="grid g-3">
          <section className="tarjeta">
            <div className="tarjeta-cab"><div><h2>Evolución por periodo</h2><div className="sub">Riesgo alto estimado y reprobación real por inasistencias</div></div></div>
            <Lineas categorias={d.historico.map((h) => h.periodo.replace("P", ""))}
              series={[
                { nombre: "En riesgo alto (%)", color: "#2563eb", valores: d.historico.map((h) => h.alto) },
                { nombre: "Reprobó por inasistencias (%)", color: "#8a93a3", valores: d.historico.map((h) => h.real), punteada: true },
              ]} />
          </section>

          <section className="tarjeta">
            <div className="tarjeta-cab"><div><h2>Distribución del riesgo</h2><div className="sub">Grupo de predicción, periodo {per.periodo}</div></div></div>
            <Medidor centro={String(evaluados)} rotulo="estudiantes evaluados"
              segmentos={["BAJO", "MEDIO", "ALTO"].map((k) => ({ etiqueta: TEXTO_NIVEL[k], valor: n[k] ?? 0, color: COLOR_NIVEL[k] }))} />
            <div className="leyenda" style={{ justifyContent: "center", marginTop: 4 }}>
              {["BAJO", "MEDIO", "ALTO"].map((k) => <span key={k}><i className="punto" style={{ background: COLOR_NIVEL[k] }} />{TEXTO_NIVEL[k]}: <b className="num">{n[k] ?? 0}</b></span>)}
            </div>
            <p className="sub" style={{ textAlign: "center", marginTop: 8 }}>{per.modelo ?? "Sin modelo asignado"}</p>
          </section>

          <section className="tarjeta">
            <div className="tarjeta-cab"><h2>Prioridad de atención</h2><Link className="btn btn-mini" href={`/resultados?periodo=${per.periodo}`}>Ver todos</Link></div>
            <div className="tabla-scroll">
              <table>
                <thead><tr><th>N.º</th><th>Estudiante</th><th>Nivel</th><th className="d">Inasist.</th></tr></thead>
                <tbody>
                  {d.prioridad.map((p, i) => (
                    <tr key={p.id}>
                      <td className="num sub">{i + 1}</td>
                      <td><div style={{ fontWeight: 600 }}>{verIdentidad && p.nombre ? titulo(p.nombre) : p.id_estudiante}</div><div className="sub">{titulo(p.carrera ?? "")}</div></td>
                      <td><span className={`chip ${p.nivel_riesgo}`}>{p.nivel_riesgo === "DETECTADO" ? "Detectado" : prob(p.probabilidad)}</span></td>
                      <td className="d num">{pct(p.inasist, 0)}</td>
                    </tr>
                  ))}
                  {!d.prioridad.length && <tr><td colSpan={4} className="sub">No hay casos de riesgo alto con estos filtros.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
