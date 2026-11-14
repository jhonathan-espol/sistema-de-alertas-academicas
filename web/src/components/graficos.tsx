"use client";
import { useState } from "react";

type Tip = { x: number; y: number; titulo: string; texto: string } | null;

function useTip() {
  const [tip, setTip] = useState<Tip>(null);
  const mostrar = (e: React.MouseEvent, titulo: string, texto: string) => setTip({ x: e.clientX, y: e.clientY, titulo, texto });
  const nodo = tip ? (
    <div className="tip" style={{ left: Math.min(tip.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1200) - 270), top: tip.y + 14 }}>
      <b>{tip.titulo}</b>{tip.texto}
    </div>
  ) : null;
  return { mostrar, ocultar: () => setTip(null), nodo };
}

// ------------------------------------------------------------------ Sankey de 3 columnas
export type NodoS = { id: string; etiqueta: string; color: string };
export type EnlaceS = { de: string; a: string; valor: number };

export function Sankey({ columnas, enlaces, alto = 250 }: { columnas: NodoS[][]; enlaces: EnlaceS[][]; alto?: number }) {
  const { mostrar, ocultar, nodo } = useTip();
  const W = 760, GAP = 12, ANCHO = 9, PAD = 6;
  const xs = columnas.map((_, i) => 4 + (i * (W - 8 - ANCHO)) / (columnas.length - 1));
  const total = (c: number, id: string) => {
    const ent = c > 0 ? enlaces[c - 1].filter((e) => e.a === id).reduce((s, e) => s + e.valor, 0) : 0;
    const sal = c < columnas.length - 1 ? enlaces[c].filter((e) => e.de === id).reduce((s, e) => s + e.valor, 0) : 0;
    return Math.max(ent, sal);
  };
  const pos: Record<string, { y: number; h: number; v: number; x: number; color: string; etiqueta: string }>[] = [];
  columnas.forEach((col, c) => {
    const vals = col.map((n) => total(c, n.id));
    const visibles = vals.filter((v) => v > 0).length;
    const suma = vals.reduce((a, b) => a + b, 0) || 1;
    const escala = (alto - 2 * PAD - GAP * Math.max(visibles - 1, 0)) / suma;
    let y = PAD;
    const m: (typeof pos)[number] = {};
    col.forEach((n, i) => {
      const h = vals[i] * escala;
      m[n.id] = { y, h, v: vals[i], x: xs[c], color: n.color, etiqueta: n.etiqueta };
      if (vals[i] > 0) y += h + GAP;
    });
    pos.push(m);
  });
  const cintas: React.ReactNode[] = [];
  enlaces.forEach((lista, c) => {
    const usadoDe: Record<string, number> = {}, usadoA: Record<string, number> = {};
    const orden = [...lista].filter((e) => e.valor > 0).sort((p, q) =>
      columnas[c].findIndex((n) => n.id === p.de) - columnas[c].findIndex((n) => n.id === q.de) ||
      columnas[c + 1].findIndex((n) => n.id === p.a) - columnas[c + 1].findIndex((n) => n.id === q.a));
    // el orden de llegada en el destino sigue el orden vertical del origen
    orden.forEach((e) => {
      const a = pos[c][e.de], b = pos[c + 1][e.a];
      if (!a || !b || !a.v || !b.v) return;
      const ha = (e.valor / a.v) * a.h, hb = (e.valor / b.v) * b.h;
      const y0 = a.y + (usadoDe[e.de] ?? 0), y1 = b.y + (usadoA[e.a] ?? 0);
      usadoDe[e.de] = (usadoDe[e.de] ?? 0) + ha; usadoA[e.a] = (usadoA[e.a] ?? 0) + hb;
      const x0 = a.x + ANCHO, x1 = b.x, xm = (x0 + x1) / 2;
      const color = c === 0 ? b.color : a.color;
      cintas.push(
        <path key={`${c}-${e.de}-${e.a}`} d={`M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${y1 + hb} C${xm},${y1 + hb} ${xm},${y0 + ha} ${x0},${y0 + ha} Z`}
          fill={color} opacity={0.22} style={{ transition: "opacity .15s" }}
          onMouseMove={(ev) => { (ev.currentTarget as SVGPathElement).style.opacity = "0.45"; mostrar(ev, `${a.etiqueta} → ${b.etiqueta}`, `${e.valor} estudiantes`); }}
          onMouseLeave={(ev) => { (ev.currentTarget as SVGPathElement).style.opacity = "0.22"; ocultar(); }} />,
      );
    });
  });
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${alto}`} width="100%" role="img" aria-label="Flujo de estudiantes entre jornada, nivel de riesgo y desenlace">
        {cintas}
        {pos.map((m, c) => Object.entries(m).filter(([, p]) => p.v > 0).map(([id, p]) => (
          <g key={`${c}-${id}`}>
            <rect x={p.x} y={p.y} width={ANCHO} height={Math.max(p.h, 2)} rx={3} fill={p.color}
              onMouseMove={(ev) => mostrar(ev, p.etiqueta, `${p.v} estudiantes`)} onMouseLeave={ocultar} />
            <text x={c === columnas.length - 1 ? p.x - 7 : p.x + ANCHO + 7} y={p.y + Math.min(p.h / 2 + 4, 14)}
              textAnchor={c === columnas.length - 1 ? "end" : "start"} fontSize="11.5" fill="#14161c" fontWeight={600} className="num">
              {p.v} <tspan fill="#5d6370" fontWeight={400}>{p.etiqueta}</tspan>
            </text>
          </g>
        )))}
      </svg>
      {nodo}
    </div>
  );
}

// ------------------------------------------------------------------ barras verticales (rayadas, una resaltada)
export function BarrasRayadas({ datos, decimales, alto = 190, unidad = "" }: {
  datos: { etiqueta: string; valor: number; detalle?: string }[]; decimales?: number; alto?: number; unidad?: string;
}) {
  const { mostrar, ocultar, nodo } = useTip();
  const formato = (v: number) => decimales === undefined ? `${v}` : v.toFixed(decimales);
  const [sel, setSel] = useState<number | null>(null);
  if (!datos.length) return <p className="sub">Sin datos para mostrar.</p>;
  const max = Math.max(...datos.map((d) => d.valor), 0.0001);
  const iMax = datos.findIndex((d) => d.valor === max);
  const W = 320, H = alto, base = H - 26, paso = W / datos.length, ancho = Math.min(30, paso - 8);
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Gráfico de barras">
        <defs>
          <pattern id="rayas" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" fill="#dbe6fb" /><rect width="3.5" height="8" fill="#eef3fd" />
          </pattern>
        </defs>
        <line x1="0" x2={W} y1={base - (base - 14)} y2={base - (base - 14)} stroke="#d9dce3" strokeDasharray="4 4" />
        {datos.map((d, i) => {
          const h = Math.max((d.valor / max) * (base - 14), 2), x = i * paso + (paso - ancho) / 2;
          const activo = (sel ?? iMax) === i;
          return (
            <g key={d.etiqueta + i} onMouseMove={(e) => { setSel(i); mostrar(e, d.detalle ?? d.etiqueta, `${formato(d.valor)}${unidad}`); }} onMouseLeave={() => { setSel(null); ocultar(); }}>
              <rect x={i * paso} y={0} width={paso} height={H} fill="transparent" />
              <rect x={x} y={base - h} width={ancho} height={h} rx={5} fill={activo ? "#2563eb" : "url(#rayas)"} />
              <text x={x + ancho / 2} y={H - 7} textAnchor="middle" fontSize="10.5" fill={activo ? "#14161c" : "#9aa0ab"} fontWeight={activo ? 700 : 400}>{d.etiqueta}</text>
              {activo && <text x={x + ancho / 2} y={base - h - 5} textAnchor="middle" fontSize="11" fontWeight={700} fill="#14161c" className="num">{formato(d.valor)}{unidad}</text>}
            </g>
          );
        })}
      </svg>
      {nodo}
    </div>
  );
}

// ------------------------------------------------------------------ medidor semicircular segmentado
export function Medidor({ segmentos, centro, rotulo }: {
  segmentos: { etiqueta: string; valor: number; color: string }[]; centro: string; rotulo: string;
}) {
  const { mostrar, ocultar, nodo } = useTip();
  const total = segmentos.reduce((s, x) => s + x.valor, 0) || 1;
  const R = 92, cx = 120, cy = 118, GAPA = 0.035;
  let ang = Math.PI;
  const arcos = segmentos.filter((s) => s.valor > 0).map((s) => {
    const span = (s.valor / total) * Math.PI;
    const a0 = ang - GAPA / 2, a1 = ang - span + GAPA / 2;
    ang -= span;
    if (a0 <= a1) return null;
    const p = (a: number) => `${cx + R * Math.cos(a)},${cy - R * Math.sin(a)}`;
    return (
      <path key={s.etiqueta} d={`M${p(a0)} A${R},${R} 0 0 1 ${p(a1)}`} fill="none" stroke={s.color} strokeWidth="13" strokeLinecap="round"
        onMouseMove={(e) => mostrar(e, s.etiqueta, `${s.valor} estudiantes (${((100 * s.valor) / total).toFixed(0)} %)`)} onMouseLeave={ocultar} />
    );
  });
  return (
    <div style={{ position: "relative", textAlign: "center" }}>
      <svg viewBox="0 0 240 132" width="100%" style={{ maxWidth: 300 }} role="img" aria-label={rotulo}>
        <path d={`M${cx - R},${cy} A${R},${R} 0 0 1 ${cx + R},${cy}`} fill="none" stroke="#eef0f3" strokeWidth="13" strokeLinecap="round" />
        {arcos}
        <text x={cx} y={cy - 20} textAnchor="middle" fontSize="30" fontWeight={700} fill="#14161c" className="num">{centro}</text>
        <text x={cx} y={cy} textAnchor="middle" fontSize="11.5" fill="#9aa0ab">{rotulo}</text>
      </svg>
      {nodo}
    </div>
  );
}

// ------------------------------------------------------------------ líneas (un solo eje)
export function Lineas({ categorias, series, alto = 190, sufijo = " %" }: {
  categorias: string[]; series: { nombre: string; color: string; valores: (number | null)[]; punteada?: boolean }[]; alto?: number; sufijo?: string;
}) {
  const [i, setI] = useState<number | null>(null);
  const W = 420, H = alto, L = 30, R = 12, T = 12, B = 24;
  const todos = series.flatMap((s) => s.valores.filter((v): v is number => v !== null));
  const max = Math.max(...todos, 1) * 1.15;
  const x = (k: number) => L + (categorias.length === 1 ? (W - L - R) / 2 : (k * (W - L - R)) / (categorias.length - 1));
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const marcas = [0, max / 2, max];
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Evolución por periodo"
        onMouseLeave={() => setI(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          let m = 0; categorias.forEach((_, k) => { if (Math.abs(x(k) - px) < Math.abs(x(m) - px)) m = k; });
          setI(m);
        }}>
        {marcas.map((m) => (
          <g key={m}><line x1={L} x2={W - R} y1={y(m)} y2={y(m)} stroke="#eef0f3" />
            <text x={L - 6} y={y(m) + 3.5} textAnchor="end" fontSize="10" fill="#9aa0ab" className="num">{m.toFixed(0)}</text></g>
        ))}
        {categorias.map((c, k) => <text key={c} x={x(k)} y={H - 6} textAnchor="middle" fontSize="10" fill={i === k ? "#14161c" : "#9aa0ab"}>{c}</text>)}
        {i !== null && <line x1={x(i)} x2={x(i)} y1={T} y2={H - B} stroke="#c9ced8" />}
        {series.map((s) => {
          const pts = s.valores.map((v, k) => (v === null ? null : [x(k), y(v)] as const));
          const d = pts.reduce((acc, p, k) => (p ? `${acc}${acc && pts[k - 1] ? "L" : "M"}${p[0]},${p[1]} ` : acc), "");
          return (
            <g key={s.nombre}>
              <path d={d} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.punteada ? "5 4" : undefined} strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((p, k) => p && <circle key={k} cx={p[0]} cy={p[1]} r={i === k ? 4.5 : 3.2} fill="#fff" stroke={s.color} strokeWidth="2" />)}
            </g>
          );
        })}
      </svg>
      {i !== null && (
        <div className="tip" style={{ position: "absolute", left: `${Math.min((x(i) / W) * 100, 62)}%`, top: 0 }}>
          <b>{categorias[i]}</b>
          {series.map((s) => <div key={s.nombre}><span className="punto" style={{ background: s.color, marginRight: 6 }} />{s.nombre}: {s.valores[i] === null ? "—" : `${s.valores[i]!.toFixed(1)}${sufijo}`}</div>)}
        </div>
      )}
      <div className="leyenda" style={{ marginTop: 6 }}>
        {series.map((s) => <span key={s.nombre}><i className="punto" style={{ background: s.color }} />{s.nombre}</span>)}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ barras horizontales con intervalo opcional
export function BarrasH({ datos, max, decimales = 3, referencia }: {
  datos: { etiqueta: string; valor: number; ic?: [number, number]; color?: string; nota?: string; fuerte?: boolean }[];
  max?: number; decimales?: number; referencia?: { valor: number; texto: string };
}) {
  const { mostrar, ocultar, nodo } = useTip();
  const formato = (v: number) => v.toFixed(decimales);
  const tope = max ?? Math.max(...datos.map((d) => d.ic?.[1] ?? d.valor), 0.0001) * 1.08;
  const W = 560, FILA = 26, L = 210, R = 56, H = datos.length * FILA + (referencia ? 20 : 6);
  const x = (v: number) => L + (v / tope) * (W - L - R);
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Comparación">
        {referencia && (<g><line x1={x(referencia.valor)} x2={x(referencia.valor)} y1={0} y2={H - 16} stroke="#dc2626" strokeDasharray="4 3" />
          <text x={x(referencia.valor)} y={H - 4} textAnchor="middle" fontSize="10" fill="#b91c1c">{referencia.texto}</text></g>)}
        {datos.map((d, k) => {
          const yy = k * FILA + 4, color = d.color ?? "#2563eb";
          return (
            <g key={d.etiqueta + k} onMouseMove={(e) => mostrar(e, d.etiqueta, `${formato(d.valor)}${d.ic ? ` · IC 95 %: ${formato(d.ic[0])} a ${formato(d.ic[1])}` : ""}${d.nota ? ` · ${d.nota}` : ""}`)} onMouseLeave={ocultar}>
              <rect x={0} y={yy - 4} width={W} height={FILA} fill="transparent" />
              <text x={L - 10} y={yy + 12} textAnchor="end" fontSize="11.5" fill="#14161c" fontWeight={d.fuerte ? 700 : 400}>{d.etiqueta}</text>
              <rect x={L} y={yy + 2} width={Math.max(x(d.valor) - L, 2)} height={13} rx={4} fill={color} opacity={d.ic ? 0.85 : 1} />
              {d.ic && <g stroke="#14161c" strokeWidth="1.4"><line x1={x(d.ic[0])} x2={x(d.ic[1])} y1={yy + 8.5} y2={yy + 8.5} />
                <line x1={x(d.ic[0])} x2={x(d.ic[0])} y1={yy + 4.5} y2={yy + 12.5} /><line x1={x(d.ic[1])} x2={x(d.ic[1])} y1={yy + 4.5} y2={yy + 12.5} /></g>}
              <text x={Math.max(x(d.ic?.[1] ?? d.valor), L) + 6} y={yy + 12} fontSize="11" fill="#5d6370" className="num">{formato(d.valor)}</text>
            </g>
          );
        })}
      </svg>
      {nodo}
    </div>
  );
}
