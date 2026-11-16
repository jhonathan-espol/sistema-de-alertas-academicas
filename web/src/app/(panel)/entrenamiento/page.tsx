import { Filtros } from "@/components/Filtros";
import { BarrasH } from "@/components/graficos";
import { conDb } from "@/lib/db";
import { fecha } from "@/lib/datos";
import { exigirUsuario } from "@/lib/sesion";

/* eslint-disable @typescript-eslint/no-explicit-any */
const titulo = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const f3 = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Number(v).toFixed(3));
const ic = (v?: [number, number]) => (v ? `${f3(v[0])} a ${f3(v[1])}` : "—");
const NIVELES = ["", "Primero", "Segundo", "Tercero", "Cuarto", "Quinto", "Sexto"];

export default async function Entrenamiento({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await exigirUsuario();
  const d = await conDb(async (sql) => {
    const [ej] = await sql`SELECT ejecutado_en::text, resultados FROM ejecuciones_modelo WHERE activo ORDER BY id DESC LIMIT 1`;
    const periodos = await sql`SELECT DISTINCT periodo FROM inicio_clases ORDER BY 1 DESC`;
    const periodo = periodos.find((p) => p.periodo === sp.periodo)?.periodo ?? periodos[0]?.periodo ?? "";
    const nivel = Number(sp.nivel ?? 1);
    const inicios = await sql`SELECT carrera, carrera_sigla, paralelo, jornada, fecha_inicio_clases::text ini, fecha_corte_d28::text corte,
                                     n_asignaturas, n_estudiantes, dias_desfase
                              FROM inicio_clases WHERE periodo = ${periodo} AND nivel = ${nivel} ORDER BY carrera, paralelo, jornada`;
    const resumen = await sql`SELECT periodo, nivel, min(fecha_inicio_clases)::text ini, max(fecha_inicio_clases)::text tardio, count(*)::int grupos
                              FROM inicio_clases GROUP BY 1, 2 ORDER BY 1 DESC, 2`;
    return { ej, periodos, periodo, nivel, inicios, resumen };
  });
  const R: any = d.ej?.resultados;

  if (!R) {
    return (
      <>
        <header className="cabecera"><div><h1>Entrenamiento</h1><p>Aún no se ha cargado ninguna ejecución del modelo</p></div></header>
        <div className="contenido"><Comandos /></div>
      </>
    );
  }
  const base = R.modelos.find((m: any) => m.es_base);
  const sel = R.modelos.find((m: any) => m.seleccionado);
  const porPeriodo = [...new Set(R.lopo.map((l: any) => l.periodo))].sort() as string[];
  const modelosLopo = [...new Set(R.lopo.map((l: any) => l.modelo))] as string[];

  return (
    <>
      <header className="cabecera">
        <div>
          <h1>Entrenamiento</h1>
          <p>Metodología CRISP-DM · ejecución del {fecha(d.ej.ejecutado_en)} · {R.meta.periodos_entrenamiento.length + 1} periodos cerrados</p>
        </div>
      </header>

      <div className="contenido">
        <div className="grid g-4">
          <section className="tarjeta"><div className="kpi">
            <div className="rotulo">Modelo seleccionado</div>
            <div className="valor" style={{ fontSize: 20 }}>{R.meta.seleccionado.modelo}</div>
            <div className="nota" style={{ maxWidth: "none" }}>Conjunto {R.meta.seleccionado.conjunto}: {R.meta.seleccionado.descripcion}. Elegido por validación cruzada, sin mirar la prueba.</div>
          </div></section>
          <section className="tarjeta"><div className="kpi">
            <div className="rotulo">AUC-PR en prueba ({R.meta.periodo_prueba})</div>
            <div className="valor num">{f3(sel.AUC_PR)}<span className="delta" style={{ color: sel.dif_AUC_PR_vs_base > 0 ? "#15803d" : "#b91c1c" }}>{sel.dif_AUC_PR_vs_base > 0 ? "+" : ""}{f3(sel.dif_AUC_PR_vs_base)}</span></div>
            <div className="nota" style={{ maxWidth: "none" }}>Línea base: {f3(base.AUC_PR)} · IC 95 % de la diferencia: {ic(sel.dif_AUC_PR_IC95)}</div>
          </div></section>
          <section className="tarjeta"><div className="kpi">
            <div className="rotulo">Sensibilidad a igual carga</div>
            <div className="valor num">{f3(sel.Recall_igual_carga)}<span className="delta" style={{ color: sel.dif_Recall_igual_carga_vs_base > 0 ? "#15803d" : "#b91c1c" }}>{sel.dif_Recall_igual_carga_vs_base > 0 ? "+" : ""}{f3(sel.dif_Recall_igual_carga_vs_base)}</span></div>
            <div className="nota" style={{ maxWidth: "none" }}>Línea base: {f3(base.Recall)} alertando al {(100 * base.Tasa_alerta).toFixed(0)} % · IC 95 % de la diferencia: {ic(sel.dif_Recall_IC95)}</div>
          </div></section>
          <section className="tarjeta"><div className="kpi">
            <div className="rotulo">Datos</div>
            <div className="valor num">{R.meta.n_entrenamiento + R.meta.n_prueba}</div>
            <div className="nota" style={{ maxWidth: "none" }}>Entrenamiento: {R.meta.n_entrenamiento} ({R.meta.positivos_entrenamiento} positivos) · Prueba: {R.meta.n_prueba} ({R.meta.positivos_prueba} positivos)</div>
          </div></section>
        </div>

        {R.meta.horizonte && (
          <div className="aviso info">
            <b>Cohorte en curso (día {R.meta.horizonte.dias} de 28).</b> Mientras su ventana no se completa se usa un modelo de solo asistencia
            ({R.meta.horizonte.modelo}) entrenado con los periodos cerrados recortados a sus primeros {R.meta.horizonte.dias} días.
            Con tan pocos días la señal es menor: en la cohorte de prueba su AUC-PR es {f3(R.meta.horizonte.auc_pr_prueba)} (línea base al mismo día: {f3(R.meta.horizonte.auc_pr_base_prueba)}),
            frente a {f3(sel.AUC_PR)} del modelo completo al día 28. Al cargar asistencias más recientes el horizonte se actualiza solo.
          </div>
        )}

        <section className="tarjeta">
          <div className="tarjeta-cab"><div><h2>Criterios de éxito declarados antes de evaluar</h2><div className="sub">Se informan tal como resultaron, se cumplan o no</div></div></div>
          <table><tbody>
            {R.criterios.map((c: any) => (
              <tr key={c.criterio}><td style={{ width: 44, fontWeight: 700 }}>{c.criterio}</td><td>{c.descripcion}<div className="sub">{c.detalle}</div></td>
                <td style={{ width: 120 }}><span className={`chip ${c.cumple ? "ok" : "no"}`}>{c.cumple ? "Se cumple" : "No se cumple"}</span></td></tr>
            ))}
          </tbody></table>
        </section>

        <div className="grid g-2">
          <section className="tarjeta">
            <div className="tarjeta-cab"><div><h2>Modelos frente a la línea base</h2><div className="sub">AUC-PR en la cohorte de prueba {R.meta.periodo_prueba}, con IC 95 % (bootstrap)</div></div></div>
            <BarrasH referencia={{ valor: R.meta.prevalencia_prueba, texto: `azar ${R.meta.prevalencia_prueba}` }} max={1}
              datos={R.modelos.map((m: any) => ({ etiqueta: m.modelo, valor: m.AUC_PR, ic: m.AUC_PR_IC95, color: m.es_base ? "#8a93a3" : m.seleccionado ? "#2563eb" : "#a9c1f5", fuerte: m.seleccionado || m.es_base }))} />
            <div className="leyenda" style={{ marginTop: 8 }}>
              <span><i className="punto" style={{ background: "#2563eb" }} />Seleccionado</span><span><i className="punto" style={{ background: "#a9c1f5" }} />Otros modelos</span><span><i className="punto" style={{ background: "#8a93a3" }} />Línea base</span>
            </div>
          </section>
          <section className="tarjeta">
            <div className="tarjeta-cab"><div><h2>Variables que más influyen</h2><div className="sub">Importancia media |SHAP| del modelo seleccionado en la prueba</div></div></div>
            <BarrasH decimales={3} datos={R.shap.slice(0, 10).map((s: any) => ({ etiqueta: s.etiqueta.length > 34 ? `${s.etiqueta.slice(0, 33)}…` : s.etiqueta, valor: s.importancia, nota: s.direccion > 0 ? "a mayor valor, mayor riesgo" : "a mayor valor, menor riesgo" }))} />
            <p className="sub" style={{ marginTop: 8 }}>La importancia explica el modelo; no demuestra causas.</p>
          </section>
        </div>

        <section className="tarjeta">
          <div className="tarjeta-cab"><div><h2>Tabla comparativa en la cohorte de prueba</h2><div className="sub">Umbral de cada modelo fijado en entrenamiento para sensibilidad ≥ {R.meta.recall_objetivo}; “igual carga” usa la misma tasa de alerta que la línea base</div></div></div>
          <div className="tabla-scroll"><table>
            <thead><tr><th>Modelo</th><th className="d">AUC-PR</th><th>IC 95 %</th><th className="d">AUC-ROC</th><th className="d">Recall</th><th className="d">Precisión</th><th className="d">F1</th><th className="d">Tasa de alerta</th><th className="d">Recall a igual carga</th><th className="d">CV AUC-PR</th><th>Hiperparámetros</th></tr></thead>
            <tbody>
              {R.modelos.map((m: any) => (
                <tr key={m.modelo} style={m.seleccionado ? { background: "#f4f7ff" } : undefined}>
                  <td style={{ fontWeight: m.seleccionado || m.es_base ? 700 : 400, whiteSpace: "nowrap" }}>{m.modelo}{m.seleccionado && <span className="chip info" style={{ marginLeft: 8 }}>Seleccionado</span>}</td>
                  <td className="d num">{f3(m.AUC_PR)}</td><td className="num sub">{ic(m.AUC_PR_IC95)}</td><td className="d num">{f3(m.AUC_ROC)}</td>
                  <td className="d num">{f3(m.Recall)}</td><td className="d num">{f3(m.Precision)}</td><td className="d num">{f3(m.F1)}</td>
                  <td className="d num">{f3(m.Tasa_alerta)}</td><td className="d num">{f3(m.Recall_igual_carga)}</td><td className="d num">{f3(m.cv_auc_pr)}</td>
                  <td className="sub">{m.hiperparametros ? Object.entries(m.hiperparametros).map(([k, v]) => `${k}=${v}`).join(", ") : `inasistencia ≥ ${R.meta.linea_base.umbral_pct_inasistencia} %`}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>

        <section className="tarjeta">
          <div className="tarjeta-cab"><div><h2>Datos por periodo</h2><div className="sub">Primer nivel presencial. El grupo de predicción excluye los casos ya constatables al día 28</div></div></div>
          <div className="tabla-scroll"><table>
            <thead><tr><th>Periodo</th><th>Uso</th><th>Inicio de clases</th><th className="d">Estudiantes</th><th className="d">Retiros</th><th className="d">Grupo de predicción</th><th className="d">Reprobó por inasistencias</th><th className="d">Tasa</th><th className="d">Con alguna inasistencia al día 28</th><th className="d">Positivos que no continuaron</th></tr></thead>
            <tbody>
              {R.perfil.map((p: any) => (
                <tr key={p.periodo}><td style={{ fontWeight: 600 }}>{p.periodo}</td><td><span className={`chip ${p.rol === "PRUEBA" ? "info" : "neutro"}`}>{titulo(p.rol)}</span></td>
                  <td>{fecha(p.inicio_clases)}{p.dias_sin_control_asistencia > 0 && (
                    <div className="sub">Corte del día 28: {fecha(p.corte_d28)} · se pausaron {p.dias_sin_control_asistencia} días sin control de asistencia</div>)}</td>
                  <td className="d num">{p.estudiantes}</td><td className="d num">{p.retiro_voluntario}</td><td className="d num">{p.grupo_prediccion}</td>
                  <td className="d num">{p.positivos}</td><td className="d num">{p.tasa_positivos_pct} %</td><td className="d num">{p.pct_con_alguna_inasistencia_d28} %</td><td className="d num">{p.positivos_que_no_continuan_pct} %</td></tr>
              ))}
            </tbody>
          </table></div>
        </section>
        
          <section className="tarjeta">
            <div className="tarjeta-cab"><div><h2>Robustez: un periodo fuera cada vez</h2><div className="sub">AUC-PR al predecir cada periodo con un modelo que no lo vio</div></div></div>
            <div className="tabla-scroll"><table>
              <thead><tr><th>Modelo</th>{porPeriodo.map((p) => <th className="d" key={p}>{p}</th>)}</tr></thead>
              <tbody>
                {modelosLopo.map((mo) => (
                  <tr key={mo}><td style={{ whiteSpace: "nowrap", fontWeight: mo.startsWith(R.meta.seleccionado.modelo) && mo.includes(`[${R.meta.seleccionado.conjunto}]`) ? 700 : 400 }}>{mo}</td>
                    {porPeriodo.map((p) => <td className="d num" key={p}>{f3(R.lopo.find((l: any) => l.modelo === mo && l.periodo === p)?.AUC_PR)}</td>)}</tr>
                ))}
              </tbody>
            </table></div>
          </section>
          <section className="tarjeta">
            <div className="tarjeta-cab"><div><h2>Equidad por subgrupos</h2><div className="sub">Tasa de falsos negativos (FNR) del modelo seleccionado; general: {f3(R.meta.fnr_general)}</div></div></div>
            <div className="tabla-scroll"><table>
              <thead><tr><th>Subgrupo</th><th className="d">Positivos</th><th className="d">FNR modelo</th><th>IC 95 %</th><th className="d">FNR línea base</th><th className="d">Tasa de alerta</th></tr></thead>
              <tbody>
                {R.subgrupos.filter((s: any) => s.grupo !== "Sin dato").map((s: any) => (
                  <tr key={s.variable + s.grupo}><td>{s.variable}: <b>{s.grupo}</b>{s.senal && <span className="chip no" style={{ marginLeft: 8 }}>Revisar</span>}</td>
                    <td className="d num">{s.positivos}</td><td className="d num">{f3(s.FNR_modelo)}</td><td className="num sub">{s.FNR_IC95?.[0]} a {s.FNR_IC95?.[1]}</td>
                    <td className="d num">{f3(s.FNR_base)}</td><td className="d num">{f3(s.tasa_alerta_modelo)}</td></tr>
                ))}
              </tbody>
            </table></div>
          </section>

        <section className="tarjeta">
          <div className="tarjeta-cab">
            <div><h2>Fechas de inicio de clases</h2><div className="sub">Derivadas de la primera clase registrada en SIGA por carrera, nivel, paralelo y jornada. El día 1 de cada estudiante es el inicio de su grupo</div></div>
            <Filtros campos={[
              { nombre: "periodo", rotulo: "Periodo", valor: d.periodo, opciones: d.periodos.map((p) => ({ valor: p.periodo, texto: p.periodo })) },
              { nombre: "nivel", rotulo: "Nivel", valor: String(d.nivel), opciones: [1, 2, 3, 4, 5, 6].map((n) => ({ valor: String(n), texto: NIVELES[n] })) },
            ]} />
          </div>
          <div className="tabla-scroll"><table>
            <thead><tr><th>Carrera</th><th>Paralelo</th><th>Jornada</th><th>Inicio de clases</th><th>Corte día 28</th><th className="d">Asignaturas</th><th className="d">Estudiantes</th><th>Observación</th></tr></thead>
            <tbody>
              {d.inicios.map((i, k) => (
                <tr key={k}><td>{titulo(i.carrera)} <span className="sub">({i.carrera_sigla})</span></td><td>{i.paralelo}</td><td>{titulo(i.jornada)}</td><td>{fecha(i.ini)}</td><td>{fecha(i.corte)}</td>
                  <td className="d num">{i.n_asignaturas}</td><td className="d num">{i.n_estudiantes}</td>
                  <td>{i.dias_desfase > 6 ? <span className="chip MEDIO">Inició {i.dias_desfase} días después</span> : <span className="sub">{i.dias_desfase ? `+${i.dias_desfase} días (primer día de su horario)` : "—"}</span>}</td></tr>
              ))}
              {!d.inicios.length && <tr><td colSpan={8} className="sub">No hay grupos de este nivel en el periodo.</td></tr>}
            </tbody>
          </table></div>
          <details style={{ marginTop: 14 }}>
            <summary>Resumen por periodo y nivel</summary>
            <div className="tabla-scroll" style={{ marginTop: 8 }}><table>
              <thead><tr><th>Periodo</th><th>Nivel</th><th>Inicio más temprano</th><th>Inicio más tardío</th><th className="d">Grupos</th></tr></thead>
              <tbody>{d.resumen.map((r, k) => <tr key={k}><td>{r.periodo}</td><td>{NIVELES[r.nivel]}</td><td>{fecha(r.ini)}</td><td>{fecha(r.tardio)}</td><td className="d num">{r.grupos}</td></tr>)}</tbody>
            </table></div>
          </details>
        </section>

        
      </div>
    </>
  );
}

function Comandos() {
  return (
    <section className="tarjeta">
      <div className="tarjeta-cab"><div><h2>Cómo reentrenar</h2><div className="sub">El entrenamiento se ejecuta en Python, en el equipo que tiene los reportes de SIGA y ATENEA</div></div></div>
      <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
        <li>Copia los reportes nuevos en la carpeta <code>REPORTES SIGA &amp; ATENEA</code> (asistencias, matrículas, ficha socioeconómica, actividades).</li>
        <li>En la raíz del proyecto ejecuta <code>python -m ml.pipeline</code>: procesa los reportes, reconstruye el dataset al día 28, entrena, evalúa y puntúa la cohorte en curso.</li>
        <li>El último paso carga los resultados en la base indicada en <code>DATABASE_URL</code> (local o Supabase) y esta página se actualiza.</li>
      </ol>
    </section>
  );
}
