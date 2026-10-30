"use client";
// Panel de gobierno: "Casos que requieren atención" (discrepancias vecinos vs datos oficiales).
// Nunca afirma causa: muestra estado oficial vs vecinal, número de reportes, ventana, fuentes y horas.
import { useEffect, useState } from "react";
import type { CasoAtencion, Atencion } from "@/lib/store";
import { CASO_HEX } from "./engine";

const ETQ: Record<string, string> = { alerta: "REQUIERE ATENCIÓN", posible_problema: "POSIBLE PROBLEMA NO REPORTADO", explicado: "EXPLICADO POR AVISO OFICIAL", aislado: "REPORTE AISLADO" };
const OFI: Record<string, string> = { normal: "Oficial: normal", corte: "Oficial: corte vigente", riesgo: "Oficial: riesgo" };
const ATN: Record<Atencion, string> = { nuevo: "NUEVO", en_revision: "EN REVISIÓN", atendido: "ATENDIDO" };
const hora = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", hour12: false }) : "—");

function useAhora(ms = 15_000) {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setT(Date.now()), ms); return () => clearInterval(i); }, [ms]);
  return t;
}
const transcurrido = (desde: string, ahora: number) => {
  const m = Math.max(0, Math.round((ahora - Date.parse(desde)) / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

export function CasoCard({ c, foco, onAtencion, busy }: { c: CasoAtencion; foco?: boolean; onAtencion: (id: string, a: Atencion) => void; busy?: boolean }) {
  const ahora = useAhora();
  const color = CASO_HEX[c.estado] ?? "#94a3b8";
  const accion = c.estado === "alerta" || c.estado === "posible_problema";
  return (
    <div className={`rounded-xl border p-3 ${foco ? "os-alert" : ""} ${c.archivado ? "opacity-55" : ""}`} style={{ borderColor: `${color}88`, background: `${color}12` }}>
      <div className="flex items-center gap-2">
        <span className="rounded-md px-1.5 py-[2px] font-mono text-[10.5px] font-bold tracking-wider" style={{ color, boxShadow: `inset 0 0 0 1px ${color}99` }}>{ETQ[c.estado] ?? c.estado}</span>
        {c.demo && <span className="rounded-md border border-[#e879f9]/60 px-1.5 py-[1px] font-mono text-[10px] font-bold text-[#e879f9]">DEMO</span>}
        <span className="ml-auto font-mono text-[10.5px] text-slate-400">sev {c.severidad}</span>
      </div>
      <div className="mt-1.5 text-[17px] font-semibold leading-tight text-white">{c.colonia ?? "Zona"} <span className="text-[13px] font-normal text-slate-400">· {c.alcaldia}</span></div>
      <div className="mt-1 grid grid-cols-2 gap-x-3 font-mono text-[11.5px] text-slate-300">
        <span><b className="text-white">{c.n}</b> reportes únicos / {c.ventana_min} min</span>
        <span>{OFI[c.oficial] ?? c.oficial} · vecinos: falta</span>
        <span>1º {hora(c.primero)} · último {hora(c.ultimo)}</span>
        <span>abierto hace {transcurrido(c.created_at, ahora)}</span>
      </div>
      {c.razones?.[0] && <div className="mt-1.5 text-[12.5px] leading-snug text-slate-200">{c.razones[0]}</div>}
      {c.fuentes?.length > 0 && <div className="mt-1 font-mono text-[10.5px] leading-snug text-slate-400">Fuentes: {c.fuentes.map((f) => `${f.nombre} (${f.fecha})`).join(" · ")}</div>}
      <div className="mt-2 flex items-center gap-2">
        <span className="font-mono text-[10.5px] tracking-wider text-slate-400">ESTADO: <b className="text-slate-100">{c.archivado && c.atencion !== "atendido" ? "ARCHIVADO" : ATN[c.atencion]}</b></span>
        {!c.archivado && accion && (
          <div className="ml-auto flex gap-1.5">
            {c.atencion === "nuevo" && <button disabled={busy} onClick={() => onAtencion(c.id, "en_revision")} className="rounded-md border border-[#38bdf8]/60 px-2 py-1 font-mono text-[10.5px] font-bold text-[#7dd3fc] hover:bg-[#38bdf8]/15">EN REVISIÓN</button>}
            <button disabled={busy} onClick={() => onAtencion(c.id, "atendido")} className="rounded-md border border-[#22c55e]/60 px-2 py-1 font-mono text-[10.5px] font-bold text-[#86efac] hover:bg-[#22c55e]/15">ATENDIDO</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function CasosPanel({ casos, foco, onAtencion }: { casos: CasoAtencion[]; foco: string | null; onAtencion: (id: string, a: Atencion) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const activos = casos.filter((c) => !c.archivado && (c.estado === "alerta" || c.estado === "posible_problema")).sort((a, b) => b.severidad - a.severidad);
  const otros = casos.filter((c) => !activos.includes(c)).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, 3);
  const act = async (id: string, a: Atencion) => { setBusy(true); try { await onAtencion(id, a); } finally { setBusy(false); } };
  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.2em] text-slate-400">
        Casos que requieren atención <span className="rounded bg-white/10 px-1.5 text-slate-200">{activos.length}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {activos.length === 0 && <div className="text-[12.5px] leading-snug text-slate-500">Sin discrepancias: lo que reportan los vecinos coincide con los datos oficiales.</div>}
        {activos.map((c) => <CasoCard key={c.id} c={c} foco={c.id === foco} onAtencion={act} busy={busy} />)}
        {otros.length > 0 && <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Recientes / archivados</div>}
        {otros.map((c) => <CasoCard key={c.id} c={c} onAtencion={act} busy={busy} />)}
      </div>
    </div>
  );
}
