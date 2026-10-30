"use client";
import { memo } from "react";
import { textoLlegada } from "@/brain/rules/llegada.ts";
import type { ConsultaPublica, Nivel } from "@/lib/types";
import type { Summary } from "@/lib/brain";

const NIVEL: Record<Nivel, { t: string; c: string }> = {
  verde: { t: "SIN ALERTAS", c: "#22c55e" },
  ambar: { t: "ATENCIÓN", c: "#f59e0b" },
  rojo: { t: "ALERTA", c: "#ef4444" },
  gris: { t: "SIN DATOS", c: "#64748b" },
};

type BadgeKind = "oficial" | "estimado" | "sindato" | "planta" | "vecinos" | "nota" | "demo" | "prensa" | "historico" | "validar" | "aprox";
const BADGE: Record<BadgeKind, { t: string; cls: string }> = {
  oficial: { t: "OFICIAL", cls: "text-[#22c55e] border-[#22c55e]/60 bg-[#22c55e]/12" },
  estimado: { t: "ESTIMADO", cls: "text-[#f59e0b] border-[#f59e0b]/60 bg-[#f59e0b]/12" },
  sindato: { t: "SIN DATO", cls: "text-slate-300 border-slate-500/60 bg-slate-500/15" },
  planta: { t: "PLANTA", cls: "text-[#38bdf8] border-[#38bdf8]/60 bg-[#38bdf8]/10" },
  nota: { t: "PRENSA", cls: "text-[#f59e0b] border-[#f59e0b]/60 bg-[#f59e0b]/12" },
  vecinos: { t: "VECINOS", cls: "text-[#a78bfa] border-[#a78bfa]/60 bg-[#a78bfa]/12" },
  demo: { t: "CASO DE DEMOSTRACIÓN", cls: "text-white border-[#e879f9] bg-[#c026d3] shadow-[0_0_18px_rgba(232,121,249,.55)]" },
  prensa: { t: "REPORTADO EN PRENSA", cls: "text-[#38bdf8] border-[#38bdf8]/60 bg-[#38bdf8]/10" },
  historico: { t: "INFERIDO POR BASE HISTÓRICA", cls: "text-[#c4b5fd] border-[#c4b5fd]/50 bg-[#c4b5fd]/10" },
  validar: { t: "POR VALIDAR", cls: "text-[#fde68a] border-[#fde68a]/50 bg-[#fde68a]/8" },
  aprox: { t: "APROXIMADA", cls: "text-[#fde68a] border-[#fde68a]/50 bg-[#fde68a]/8" },
};

export function Badge({ k, big, label }: { k: BadgeKind; big?: boolean; label?: string }) {
  return (
    <span className={`inline-flex items-center rounded-md border font-mono font-bold tracking-wider whitespace-nowrap ${big ? "px-2.5 py-1 text-[13px]" : "px-1.5 py-[1px] text-[10.5px]"} ${BADGE[k].cls}`}>
      {label ?? BADGE[k].t}
    </span>
  );
}

const fecha = (f?: string) => (f ? f.replace(/T.*/, "") : "s/f");
function Src({ n, f, url }: { n: string; f?: string; url?: string | null }) {
  const inner = <>{n} · {fecha(f)}{url ? " ↗" : ""}</>;
  return url ? <a href={url} target="_blank" rel="noreferrer" className="font-mono text-[10.5px] text-slate-500 hover:text-[#38bdf8]">{inner}</a> : <span className="font-mono text-[10.5px] text-slate-500">{inner}</span>;
}

interface Row { label: string; value: React.ReactNode; src?: React.ReactNode; badge?: React.ReactNode; wide?: boolean }

function Rows({ rows, id }: { rows: Row[]; id: string }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
      {rows.map((r, i) => (
        <div key={id + i} className={`os-row min-w-0 ${r.wide ? "col-span-2" : ""}`} style={{ animationDelay: `${(i + 5) * 60}ms` }}>
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400">{r.label}{r.badge}</div>
          <div className="truncate text-[13.5px] leading-[1.3] text-slate-100">{r.value}</div>
          {r.src && <div className="truncate leading-tight">{r.src}</div>}
        </div>
      ))}
    </div>
  );
}

export const Detail = memo(function Detail({ c, s, compact }: { c: ConsultaPublica; s: Summary | null; compact?: boolean }) {
  const r = c.resultado;
  const res = r.resultado;
  const sig = r.signals;
  const n = NIVEL[c.nivel];
  const a = s?.alcaldias[c.cve_mun] as any;
  const fz = s?.fuentes;
  const ll = r.llegada;
  const llBadge: BadgeKind = ll.tipo === "oficial" ? "oficial" : ll.tipo === "estimado" ? "estimado" : "sindato";
  const llText = textoLlegada(ll).replace(/^⏱ /, "").replace(/^ESTIMADO \(no oficial\): /, "");
  const cal = r.calidad;
  const calBadge: BadgeKind | null = cal ? (cal.es_demo ? "demo" : cal.origen === "planta" ? "planta" : cal.origen === "prensa" ? "nota" : "vecinos") : null;
  const reportesHoy = sig.reportes24h ?? { sin_agua: 0, calidad: 0 };

  const rows: Row[] = [
    {
      label: "Sequía",
      value: sig.sequia?.categoria ? `Categoría ${sig.sequia.categoria}` : "Sin sequía",
      src: <Src n="SMN Monitor de Sequía" f={sig.sequia?.fuente.fecha} url={sig.sequia?.fuente.url} />,
    },
    {
      label: "Cutzamala",
      value: (
        <span>
          {s ? `${s.cutzamala.total_pct.toFixed(1)}%` : sig.cutzamala ? `${sig.cutzamala.pct.toFixed(1)}%` : "sin dato"}
          {s && <span className="ml-1.5 font-mono text-[10.5px] text-slate-400">{s.cutzamala.presas.map((p) => `${p.nombre.split(" ").map((w) => w[0]).join("").replace("VdB", "VB")} ${p.pct?.toFixed(0)}`).join(" · ")}</span>}
        </span>
      ),
      src: <Src n={sig.cutzamala && !sig.cutzamala.aplica ? "CONAGUA · no es su fuente principal" : "CONAGUA"} f={sig.cutzamala?.fuente.fecha} url={sig.cutzamala?.fuente.url} />,
    },
    {
      label: "Los Berros · planta",
      value: s
        ? s.berros.fuera_de_norma.length ? <span className="text-[#f59e0b]">fuera de norma: {s.berros.fuera_de_norma.join(", ")}</span> : "Dentro de norma"
        : "sin dato",
      src: <Src n="CONAGUA · no es tu llave" f={s?.berros.fecha} url={fz?.berros.url} />,
    },
    {
      label: "Lluvia 7 d",
      value: sig.lluvia ? `${sig.lluvia.mm_7d} mm` : "sin dato",
      src: <Src n="Open-Meteo (modelo)" f={sig.lluvia?.fuente.fecha} url={sig.lluvia?.fuente.url} />,
    },
    {
      label: "Sin agua entubada",
      value: sig.vulnerabilidad?.pct_sin_agua_entubada != null ? `${sig.vulnerabilidad.pct_sin_agua_entubada}% viviendas (mín.)` : "sin dato",
      src: <Src n="INEGI Censo" f={fz?.inegi.fecha} url={fz?.inegi.url} />,
    },
    {
      label: "Tandeo 2019",
      value: (
        <span>
          {sig.vulnerabilidad?.colonia_tandeo_2019 ? "Colonia con tandeo" : "Sin registro"}
          {a?.tandeo_2019 && <span className="ml-1.5 font-mono text-[11px] text-slate-400">{a.tandeo_2019.colonias} en alcaldía</span>}
        </span>
      ),
      src: <Src n="SACMEX" f={fz?.tandeo.fecha} url={fz?.tandeo.url} />,
    },
    {
      label: "Reportes 24 h",
      value: `${reportesHoy.sin_agua} sin agua · ${reportesHoy.calidad} turbia/olor`,
      src: <Src n="Sed · vecinos únicos" f={c.created_at} />,
    },
    {
      label: "Reportes hist.",
      value: a?.reportes_hist ? <span>{a.reportes_hist.falta_de_agua.toLocaleString("es-MX")} <span className="font-mono text-[10.5px] text-slate-400">{Math.round(a.reportes_hist.por_1000)}/1000 viv{a.reportes_hist.sobre_p75 ? " · >p75" : ""}</span></span> : "sin dato",
      src: <Src n="SACMEX 2022–24" f={fz?.reportes.fecha} url={fz?.reportes.url} />,
    },
    {
      label: "Abastecimiento",
      badge: <Badge k="validar" />,
      value: a?.abastecimiento ? a.abastecimiento.sistemas.map((x: string) => x.replace(" (proporción por validar)", "")).join(" · ") : "sin dato",
      src: <Src n="curado de prensa" f={fz?.abast.fecha} url={a?.abastecimiento?.fuentes?.[0]?.url} />,
      wide: true,
    },
  ];

  return (
    <div key={c.id} className={`flex flex-col gap-3.5 ${compact ? "os-static" : ""}`}>
      {/* encabezado */}
      <div className="os-row" style={{ animationDelay: "0ms" }}>
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400">
          <span>{c.alcaldia}</span>
          {c.resultado.coord_nota && <Badge k="aprox" />}
          {c.demo && <Badge k="demo" />}
        </div>
        <div className="mt-0.5 text-[26px] font-semibold leading-tight text-white">{c.colonia ?? "Colonia sin identificar"}</div>
        <div className="mt-2 flex items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-[15px] font-bold tracking-wider" style={{ color: n.c, background: `${n.c}1f`, boxShadow: `inset 0 0 0 1px ${n.c}88, 0 0 24px ${n.c}33` }}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: n.c, boxShadow: `0 0 10px ${n.c}` }} />{n.t}
          </span>
          <span className="font-mono text-[12px] text-slate-400">confianza <b className="text-slate-200">{res.confianza}</b> · puntaje {res.puntaje.total}{res.puntaje.c ? ` · C ${res.puntaje.c}` : ""}</span>
        </div>
      </div>

      {/* cuándo llega */}
      <div className="os-row rounded-xl border border-white/8 bg-white/[0.03] p-3" style={{ animationDelay: "60ms" }}>
        <div className="mb-1 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-slate-400">
          Cuándo llega <Badge k={llBadge} big />{r.llegada_demo && <Badge k="demo" />}
        </div>
        <div className="text-[15.5px] leading-snug text-white">{llText}</div>
        {ll.tipo === "oficial" && <div className="mt-1"><Src n={ll.fuente.nombre} f={ll.fuente.fecha} url={ll.fuente.url} /></div>}
        {ll.tipo === "estimado" && <div className="mt-1 text-[12px] text-slate-400">No oficial · base: {ll.base}{r.llegada_demo ? " · fuente: caso de demostración" : ""}</div>}
      </div>

      {/* calidad */}
      <div className={`os-row rounded-xl border p-3 ${cal?.es_demo ? "border-[#e879f9]/70 bg-[#c026d3]/12" : "border-white/8 bg-white/[0.03]"}`} style={{ animationDelay: "120ms" }}>
        <div className="mb-1 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-slate-400">
          Calidad {calBadge ? <Badge k={calBadge} big /> : <Badge k="sindato" label="SIN AVISO" />}
        </div>
        {cal ? (
          <>
            <div className="text-[15px] leading-snug text-white">{cal.texto}</div>
            <div className="mt-0.5 text-[13px] text-slate-300">{cal.recomendacion}</div>
            {cal.es_demo && <div className="mt-1 font-mono text-[11px] text-[#f0abfc]">Fuente: caso de demostración — no es un hecho real</div>}
            {!cal.es_demo && cal.fuente && <div className="mt-1"><Src n={cal.fuente.nombre} f={cal.fuente.fecha} url={cal.fuente.url} /></div>}
          </>
        ) : (
          <div className="text-[13.5px] text-slate-300">Sin señal de calidad. Si sale turbia o con olor, no la bebas y repórtala.</div>
        )}
      </div>

      {/* razones */}
      {!compact && (
        <div className="os-row" style={{ animationDelay: "180ms" }}>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-slate-400">Razones</div>
          <ul className="mt-0.5 text-[13px] leading-snug text-slate-200">
            {res.razones.slice(0, 2).map((x, i) => <li key={i} className="before:mr-1.5 before:text-slate-500 before:content-['›']">{x}</li>)}
          </ul>
        </div>
      )}

      {/* caso demo / prensa */}
      {r.caso && (
        <div className="os-row rounded-xl border border-white/8 bg-white/[0.03] p-3" style={{ animationDelay: "200ms" }}>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge k={r.caso.tipo === "reportado en prensa" ? "prensa" : "historico"} big />
            {r.caso.nota_fecha && <Badge k="validar" label="FECHA POR VALIDAR" />}
          </div>
          <div className="font-mono text-[11.5px] text-slate-300">{r.caso.frase}</div>
          {!compact && <div className="line-clamp-2 text-[13px] leading-snug text-slate-200">{r.caso.descripcion}</div>}
          <div className="mt-1 flex flex-wrap gap-x-3">
            {r.caso.fuentes.slice(0, 3).map((f) => <Src key={f.url} n={f.medio} f={r.caso!.fecha} url={f.url} />)}
          </div>
        </div>
      )}
      {!compact && r.escenarios?.filter((e) => (e.id.includes("azufre") ? !!cal?.es_demo : r.llegada_demo)).map((e) => (
        <div key={e.id} className="os-row rounded-lg border border-[#e879f9]/50 bg-[#c026d3]/10 px-3 py-2 text-[12px] leading-snug text-[#f5d0fe]" style={{ animationDelay: "220ms" }}>
          <b className="font-mono text-[10.5px] tracking-wider text-[#f0abfc]">POR QUÉ ESTE DEMO · </b>{e.por_que}
        </div>
      ))}

      {!compact && <Rows rows={rows} id={c.id} />}

      {!compact && (
        <div className="os-row border-t border-white/8 pt-2" style={{ animationDelay: `${(rows.length + 5) * 60}ms` }}>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-slate-400">Fuentes del semáforo</div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {res.fuentes.map((f) => <Src key={f.nombre + f.fecha} n={f.nombre} f={f.fecha} url={f.url} />)}
          </div>
          {c.resultado.coord_nota && <div className="mt-1 text-[11px] text-[#fde68a]">{c.resultado.coord_nota}</div>}
        </div>
      )}
    </div>
  );
});

export function MultiList({ list, active }: { list: ConsultaPublica[]; active: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[#38bdf8]">Multi-punto · {list.length} consultas</div>
      {list.map((c, i) => {
        const n = NIVEL[c.nivel];
        const ll = c.resultado.llegada.tipo;
        return (
          <div key={c.id} className={`os-row flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors ${active === c.id ? "bg-white/[0.07] ring-1 ring-white/15" : ""}`} style={{ animationDelay: `${i * 60}ms` }}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: n.c, boxShadow: `0 0 8px ${n.c}` }} />
            <span className="min-w-0 flex-1 truncate text-[14px] text-white">{c.colonia ?? c.alcaldia}<span className="ml-1.5 text-[12px] text-slate-400">{c.alcaldia}</span></span>
            {c.demo && <Badge k="demo" label="DEMO" />}
            <Badge k={ll === "oficial" ? "oficial" : ll === "estimado" ? "estimado" : "sindato"} />
          </div>
        );
      })}
    </div>
  );
}
