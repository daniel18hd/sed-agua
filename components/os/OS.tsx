"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConsultaPublica, Nivel } from "@/lib/types";
import type { Summary } from "@/lib/brain";
import type { ReportePublico, CasoAtencion, Atencion } from "@/lib/store";
import { OsEngine, type Mode } from "./engine";
import { subscribe, broadcast, loadDemoEvents, fresh, type Status } from "./realtime";
import { Detail, MultiList, Badge } from "./Panel";
import { CasosPanel } from "./Casos";

const DOT: Record<Nivel, string> = { verde: "#22c55e", ambar: "#f59e0b", rojo: "#ef4444", gris: "#64748b" };

export interface OSProps {
  styleUrl: string;
  satTiles?: string;
  mock: boolean;
  burst: number;
  every: number;
  qrSrc: string;
  qrPlaceholder: boolean;
  qrNota?: string;
  waNumber?: string;
  idleMin: number;          // reposo tras X min sin eventos (?idle=)
  demoScenarios: boolean;   // DEMO_SCENARIOS=1 → botones de demo de discrepancias
  qrParam?: "0" | "1";      // ?qr=0|1 (prioridad sobre localStorage)
}

function Clock() {
  const [t, setT] = useState("");
  useEffect(() => {
    const f = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    const d = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", year: "numeric" });
    const tick = () => { const n = new Date(); setT(`${d.format(n).toUpperCase()} · ${f.format(n)}`); };
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, []);
  return <span suppressHydrationWarning>{t}</span>;
}

/** Si el panel no cabe en 1080 px, lo escala (máx. −18 %) en vez de hacer scroll. */
function useFit(dep: unknown) {
  const outer = useRef<HTMLElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return;
    const fit = () => {
      i.style.transform = "";
      const avail = o.clientHeight - 32;
      const need = i.scrollHeight;
      const k = need > avail ? Math.max(0.82, avail / need) : 1;
      i.style.transform = k < 1 ? `scale(${k})` : "";
      i.style.width = k < 1 ? `${100 / k}%` : "";
    };
    const ro = new ResizeObserver(fit);
    ro.observe(i);
    ro.observe(o);
    const t = setTimeout(fit, 1200); // tras el stagger
    return () => { ro.disconnect(); clearTimeout(t); };
  }, [dep]);
  return { outer, inner };
}


type Tick = { k: "c"; id: string; at: string; c: ConsultaPublica } | { k: "r"; id: string; at: string; r: ReportePublico };
const REP_TXT: Record<string, string> = { sin_agua: "sin agua", baja_presion: "baja presión", mala_calidad: "agua turbia/olor" };
const REP_DOT: Record<string, string> = { sin_agua: "#fb923c", baja_presion: "#facc15", mala_calidad: "#a78bfa" };
const RANKC: Record<string, number> = { aislado: 1, explicado: 1, posible_problema: 2, alerta: 3 };

export default function OS(p: OSProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const eng = useRef<OsEngine | null>(null);
  const demoEv = useRef<ConsultaPublica[]>([]);
  const demoIdx = useRef(0);
  const demoTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const multiTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const casosRef = useRef<Map<string, CasoAtencion>>(new Map());
  const simRef = useRef(0);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [status, setStatus] = useState<{ s: Status; via: string }>({ s: "connecting", via: "" });
  const [mode, setMode] = useState<Mode>("idle");
  const [detail, setDetail] = useState<ConsultaPublica | null>(null);
  const [multi, setMulti] = useState<ConsultaPublica[]>([]);
  const [toast, setToast] = useState<ConsultaPublica | null>(null);
  const [ticker, setTicker] = useState<Tick[]>([]);
  const [count, setCount] = useState(0);
  const [sat, setSat] = useState(false);
  const [demoOn, setDemoOn] = useState(false);
  const [offline, setOffline] = useState(false);
  const [casos, setCasos] = useState<CasoAtencion[]>([]);
  const [casoFoco, setCasoFoco] = useState<string | null>(null);
  const [alerta, setAlerta] = useState<CasoAtencion | null>(null);
  const [reps, setReps] = useState<ReportePublico[]>([]);
  const [promedio, setPromedio] = useState<number | null>(null);
  const [ventana, setVentana] = useState(60);
  const fitRef = useFit(`${detail?.id}-${multi.length}`);
  // QR visible/oculto: ?qr= > localStorage["sed.qr.visible"] > visible. Oculto = opacity 0 (el layout no se mueve).
  const [qrOn, setQrOn] = useState(p.qrParam ? p.qrParam === "1" : true);
  useEffect(() => {
    if (p.qrParam) return;
    try { const v = localStorage.getItem("sed.qr.visible"); if (v != null) setQrOn(v !== "false"); } catch {}
  }, [p.qrParam]);
  const toggleQr = useCallback(() => setQrOn((v) => { try { localStorage.setItem("sed.qr.visible", String(!v)); } catch {} return !v; }), []);

  // ---- consultas ----
  const ingest = useCallback((c: ConsultaPublica, o: { backfill: boolean }) => {
    const e = eng.current;
    if (!e) return;
    if (!e.push(c, { animate: !o.backfill })) {
      if (c.resultado?.llamada) {
        setTicker((t) => t.map((x) => (x.k === "c" && x.id === c.id ? { ...x, c } : x)));
        setDetail((d) => (d?.id === c.id ? c : d));
      }
      return;
    }
    setTicker((t) => [{ k: "c" as const, id: c.id, at: c.created_at, c }, ...t].slice(0, 8));
    setCount((n) => n + 1);
  }, []);

  // ---- reportes de vecinos (punto + pulso + feed; no mueven la cámara) ----
  const ingestReporte = useCallback((r: ReportePublico, o: { backfill: boolean }) => {
    if (!eng.current?.pushReporte(r, { animate: !o.backfill })) return;
    setReps((l) => [...l.filter((x) => Date.now() - Date.parse(x.created_at) < 3 * 3_600_000), r]);
    if (!o.backfill) setTicker((t) => [{ k: "r" as const, id: `r-${r.id}`, at: r.created_at, r }, ...t].slice(0, 8));
  }, []);

  // ---- casos (discrepancias) ----
  const applyCasos = useCallback((list: CasoAtencion[], foco?: CasoAtencion) => {
    const arr = [...list].sort((a, b) => b.severidad - a.severidad);
    setCasos(arr);
    eng.current?.setCasos(arr, foco);
  }, []);
  const ingestCaso = useCallback((c: CasoAtencion) => {
    const prev = casosRef.current.get(c.id);
    casosRef.current.set(c.id, c);
    const escalo = !c.archivado && (RANKC[c.estado] ?? 0) >= 2 && (RANKC[c.estado] ?? 0) > (RANKC[prev?.estado ?? ""] ?? 0);
    if (escalo) { setAlerta(c); setCasoFoco(c.id); }
    if (c.archivado && alertaIdRef.current === c.id) setAlerta(null);
    applyCasos([...casosRef.current.values()], escalo ? c : undefined);
  }, [applyCasos]);
  const alertaIdRef = useRef<string | null>(null);
  useEffect(() => { alertaIdRef.current = alerta?.id ?? null; }, [alerta]);

  const cargarPanel = useCallback(async () => {
    try {
      const r = await fetch("/api/casos", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      const m = new Map<string, CasoAtencion>();
      for (const c of j.casos as CasoAtencion[]) m.set(c.id, c);
      casosRef.current = m;
      applyCasos([...m.values()]);
      setPromedio(j.stats.promedio_atencion_min);
      setVentana(j.config.ventanaMin);
      for (const rp of j.reportes as ReportePublico[]) ingestReporte(rp, { backfill: true });
    } catch {}
  }, [applyCasos, ingestReporte]);

  const cambiarAtencion = useCallback(async (id: string, atencion: Atencion) => {
    const r = await fetch(`/api/casos/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ atencion }) });
    if (r.ok) { const c = await r.json(); ingestCaso(c); if (c.archivado && alerta?.id === id) setAlerta(null); void cargarPanel(); }
  }, [ingestCaso, cargarPanel, alerta]);

  // motor + realtime
  const subRef = useRef<() => void>(() => {});
  const conectar = useCallback(() => {
    subRef.current();
    subRef.current = subscribe(ingest, (s, via) => setStatus({ s, via }), { onReporte: ingestReporte, onCaso: ingestCaso });
  }, [ingest, ingestReporte, ingestCaso]);

  useEffect(() => {
    if (!mapRef.current) return;
    const e = new OsEngine({
      container: mapRef.current,
      styleUrl: p.styleUrl,
      satTiles: p.satTiles,
      idleAfterMs: p.idleMin * 60_000,
      onReady: ({ offline }) => setOffline(offline),
      cb: {
        onMode: (m) => { setMode(m); if (m === "single") setMulti([]); }, // el reposo NO borra el panel
        onPanel: (c) => setDetail(c),
        onToast: (c) => setToast(c),
        onMulti: (l, principal) => { setMulti(l); setDetail(principal); },
        onCasoFoco: (c) => { setCasoFoco(c.id); },
        onReset: () => { setDetail(null); setMulti([]); setToast(null); setTicker([]); setAlerta(null); setCasoFoco(null); setReps([]); },
      },
    });
    eng.current = e;
    void e.start();
    (window as any).__sedEngine = e;
    conectar();
    void cargarPanel();
    const poll = setInterval(() => void cargarPanel(), 30_000); // también archiva zonas que volvieron a normal
    fetch("/api/brain/summary").then((r) => r.json()).then(setSummary).catch(() => {});
    return () => { subRef.current(); clearInterval(poll); e.destroy(); eng.current = null; };
  }, [p.styleUrl, p.satTiles, p.idleMin, conectar, cargarPanel]);

  // toast: 6.5 s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(t);
  }, [toast]);

  // multi: rota el detalle cada 3 s
  useEffect(() => {
    if (multiTimer.current) clearInterval(multiTimer.current);
    if (mode !== "multi" || multi.length < 2) return;
    let i = 0;
    multiTimer.current = setInterval(() => { i = (i + 1) % multi.length; setDetail(multi[i]); }, 3000);
    return () => { if (multiTimer.current) clearInterval(multiTimer.current); };
  }, [mode, multi]);

  // demo / mock (la presentación nunca termina sola: el intervalo corre hasta que se detiene)
  const emit = useCallback((c: ConsultaPublica) => { const f = fresh(c); ingest(f, { backfill: false }); broadcast(f); }, [ingest]);
  const nextDemo = useCallback(() => {
    const ev = demoEv.current;
    if (!ev.length) return;
    emit(ev[demoIdx.current % ev.length]);
    demoIdx.current++;
  }, [emit]);
  const ensureDemo = useCallback(async () => { if (!demoEv.current.length) demoEv.current = await loadDemoEvents(); }, []);
  const startDemo = useCallback(async () => {
    await ensureDemo();
    if (demoTimer.current) clearInterval(demoTimer.current);
    nextDemo();
    demoTimer.current = setInterval(nextDemo, p.every * 1000);
    setDemoOn(true);
    setStatus((s) => (s.s === "live" ? s : { s: "mock", via: "local" }));
  }, [ensureDemo, nextDemo, p.every]);
  const stopDemoTimer = useCallback(() => { if (demoTimer.current) clearInterval(demoTimer.current); demoTimer.current = null; setDemoOn(false); }, []);
  const burst = useCallback(async (n: number) => {
    await ensureDemo();
    const ev = demoEv.current;
    for (let i = 0; i < n && ev.length; i++) { emit(ev[demoIdx.current % ev.length]); demoIdx.current++; }
  }, [ensureDemo, emit]);

  /** R: OS limpio sin recargar (cola, timers, capas, puntos, cámara al globo) y Realtime reconectado. */
  const reset = useCallback(() => {
    simRef.current++;
    eng.current?.reset();
    conectar();
    void cargarPanel();
  }, [conectar, cargarPanel]);
  /** D: detener la demo y dejar el OS limpio. */
  const detener = useCallback(() => { stopDemoTimer(); reset(); }, [stopDemoTimer, reset]);

  /** Demo de discrepancias: reportes [DEMO] de vecinos distintos en Agrícola Oriental hasta llegar a `hasta`. */
  const simularReportes = useCallback(async (hasta: number) => {
    const my = ++simRef.current;
    for (let i = 0; i < 10 && my === simRef.current; i++) {
      const r = await fetch("/api/dev/reportes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hasta }) }).then((x) => x.json()).catch(() => null);
      if (!r || r.error || r.n >= hasta) break;
      await new Promise((ok) => setTimeout(ok, 900));
    }
  }, []);
  const reiniciarReportesDemo = useCallback(async () => {
    simRef.current++;
    await fetch("/api/dev/reportes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reset: true }) }).catch(() => {});
    setAlerta(null);
    void cargarPanel();
  }, [cargarPanel]);

  useEffect(() => {
    let t1: any, t2: any;
    if (p.mock || p.burst) {
      void ensureDemo();
      if (p.burst) t1 = setTimeout(() => void burst(p.burst), 2200);
      if (p.mock) t2 = setTimeout(() => void startDemo(), p.burst ? 20000 : 2200);
    }
    return () => { clearTimeout(t1); clearTimeout(t2); stopDemoTimer(); };
  }, [p.mock, p.burst, ensureDemo, burst, startDemo, stopDemoTimer]);

  // atajos: espacio demo · D detener · R reset · B ×5 · X ×10 · I reposo · S satélite · 3/5 reportes demo · 0 reinicia demo de reportes
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey) return;
      const key = e.key.toLowerCase();
      if (key === " ") { e.preventDefault(); if (demoTimer.current) stopDemoTimer(); else void startDemo(); }
      if (key === "d") detener();
      if (key === "r") reset();
      if (key === "b") void burst(5);
      if (key === "x") void burst(10);
      if (key === "i") eng.current?.idleNow();
      if (key === "s" && p.satTiles) setSat((v) => !v);
      if (key === "3") void simularReportes(3);
      if (key === "5") void simularReportes(5);
      if (key === "0") void reiniciarReportesDemo();
      if (key === "q") toggleQr();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [startDemo, stopDemoTimer, detener, reset, burst, simularReportes, reiniciarReportesDemo, toggleQr, p.satTiles]);

  useEffect(() => { eng.current?.setSat(sat); }, [sat]);

  const live = status.s === "live" ? "LIVE" : status.s === "mock" ? "MOCK" : status.s === "connecting" ? "CONECTANDO" : "OFFLINE";
  const liveColor = status.s === "live" ? "#22c55e" : status.s === "mock" ? "#e879f9" : status.s === "connecting" ? "#f59e0b" : "#ef4444";
  const ahora = Date.now();
  const repsActivos = reps.filter((r) => ahora - Date.parse(r.created_at) <= ventana * 60_000).length;
  const zonas = casos.filter((c) => !c.archivado && (c.estado === "posible_problema" || c.estado === "alerta")).length;
  const demoBtns = p.mock || p.demoScenarios;

  return (
    <div className="os-root fixed inset-0 overflow-hidden bg-[#05070b] text-slate-200 select-none">
      <div className="os-halo pointer-events-none absolute inset-0" />
      <div className="absolute inset-0"><div ref={mapRef} className="h-full w-full" /></div>
      <div className="os-vignette pointer-events-none absolute inset-0" />

      {/* arriba-izq */}
      <div className="glass absolute left-6 top-6 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="font-mono text-[15px] font-bold tracking-[0.28em] text-white">SED <span className="text-[#38bdf8]">//</span> CDMX WATER OS</div>
          <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] font-bold tracking-widest" style={{ color: liveColor, borderColor: `${liveColor}66` }}>
            <span className="os-blink h-1.5 w-1.5 rounded-full" style={{ background: liveColor }} />{live}
          </span>
        </div>
        <div className="mt-1 flex gap-3 font-mono text-[11.5px] text-slate-400">
          <Clock /><span className="text-slate-600">|</span><span>{status.via === "supabase" ? "SUPABASE RT" : status.via === "sse" ? "BUS LOCAL" : status.via === "local" ? "MOCK LOCAL" : "—"}</span>
          {offline && <><span className="text-slate-600">|</span><span className="text-[#fde68a]">mapa offline</span></>}
          <span className="text-slate-600">|</span><span className="uppercase">{mode}</span>
        </div>
      </div>

      {/* arriba-der: contadores + controles */}
      <div className="absolute right-6 top-6 flex items-center gap-2">
        {p.satTiles && (
          <div className="glass flex overflow-hidden p-0 font-mono text-[12px] font-bold tracking-widest">
            <button className={`px-3 py-2 ${!sat ? "bg-white/10 text-white" : "text-slate-400"}`} onClick={() => setSat(false)}>MAP</button>
            <button className={`px-3 py-2 ${sat ? "bg-white/10 text-white" : "text-slate-400"}`} onClick={() => setSat(true)}>SAT</button>
          </div>
        )}
        <div className="glass flex gap-4 px-4 py-2 text-right">
          {[
            { k: "Consultas", v: String(count) },
            { k: "Reportes activos", v: String(repsActivos) },
            { k: "Zonas en discrepancia", v: String(zonas), c: zonas ? "#ff2e88" : undefined },
            { k: "T. prom. atención", v: promedio == null ? "—" : `${promedio} min` },
          ].map((x) => (
            <div key={x.k}>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-slate-400">{x.k}</div>
              <div className="font-mono text-[19px] font-bold leading-none tabular-nums" style={{ color: x.c ?? "#fff" }}>{x.v}</div>
            </div>
          ))}
        </div>
        <button onClick={() => (demoOn ? stopDemoTimer() : void startDemo())} title="Demo (espacio)" className={`glass px-3 py-3 font-mono text-[12px] font-bold tracking-widest ${demoOn ? "text-[#e879f9] ring-1 ring-[#e879f9]/60" : "text-slate-200 hover:text-white"}`}>
          {demoOn ? "■ DEMO" : "▶ DEMO"}
        </button>
        <button onClick={() => void burst(5)} title="5 consultas a la vez (B)" className="glass px-3 py-3 font-mono text-[12px] font-bold text-slate-300 hover:text-white">×5</button>
        <button onClick={() => void burst(10)} title="10 consultas a la vez (X)" className="glass px-3 py-3 font-mono text-[12px] font-bold text-slate-300 hover:text-white">×10</button>
        <button onClick={reset} title="Reset sin recargar (R) · Detener (D)" className="glass px-3 py-3 font-mono text-[12px] font-bold tracking-widest text-slate-300 hover:text-white">⟲ R</button>
      </div>

      {/* izquierda: casos que requieren atención */}
      <aside className="glass absolute bottom-[224px] left-6 top-[100px] flex w-[400px] flex-col px-4 py-3">
        {alerta && !alerta.archivado && (
          <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-[#ff2e88]">● Requiere atención · {alerta.colonia ?? "zona"}</div>
        )}
        <div className="min-h-0 flex-1"><CasosPanel casos={casos} foco={casoFoco} onAtencion={cambiarAtencion} /></div>
        {demoBtns && (
          <div className="mt-2 flex gap-1.5 border-t border-white/8 pt-2">
            <button onClick={() => void simularReportes(3)} title="3 reportes [DEMO] en Agrícola Oriental (tecla 3)" className="rounded-md border border-[#fb923c]/50 px-2 py-1 font-mono text-[10.5px] font-bold text-[#fdba74] hover:bg-[#fb923c]/15">3 REPORTES [DEMO]</button>
            <button onClick={() => void simularReportes(5)} title="hasta 5 reportes [DEMO] (tecla 5)" className="rounded-md border border-[#ff2e88]/50 px-2 py-1 font-mono text-[10.5px] font-bold text-[#ff7ab8] hover:bg-[#ff2e88]/15">5 [DEMO]</button>
            <button onClick={() => void reiniciarReportesDemo()} title="reiniciar demo de reportes (tecla 0)" className="ml-auto rounded-md border border-white/15 px-2 py-1 font-mono text-[10.5px] font-bold text-slate-400 hover:text-white">⟲ demo</button>
          </div>
        )}
      </aside>

      {/* derecha: panel de la consulta */}
      <aside ref={fitRef.outer} className={`glass os-panel absolute bottom-[186px] right-6 top-[100px] w-[520px] overflow-hidden px-5 py-4 transition-[opacity,transform] duration-500 ${detail || multi.length ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-6 opacity-0"}`}>
        <div ref={fitRef.inner} className="origin-top-left">
          {mode === "multi" && multi.length > 0 && (
            <div className="mb-3 border-b border-white/8 pb-3"><MultiList list={multi} active={detail?.id ?? null} /></div>
          )}
          {detail && <Detail key={detail.id} c={detail} s={summary} compact={mode === "multi"} />}
        </div>
      </aside>

      {/* abajo-izq: feed */}
      <div className="glass absolute bottom-6 left-6 w-[460px] px-4 py-3">
        <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.2em] text-slate-400">En vivo · consultas y reportes</div>
        {ticker.length === 0 && <div className="font-mono text-[12.5px] text-slate-500">Esperando consultas… escanea el QR</div>}
        <div className="flex flex-col gap-1">
          {ticker.slice(0, 6).map((x) => (
            <div key={x.id} className="os-tick flex items-center gap-2 font-mono text-[12.5px]">
              <span className="text-slate-500 tabular-nums">{new Date(x.at).toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City", hour12: false })}</span>
              {x.k === "c" ? (
                <>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: DOT[x.c.nivel], boxShadow: `0 0 6px ${DOT[x.c.nivel]}` }} />
                  <span className="min-w-0 flex-1 truncate text-slate-100">{x.c.colonia ?? "—"}<span className="text-slate-500"> · {x.c.alcaldia}</span></span>
                  {x.c.resultado.llamada && <span title={`llamada: ${x.c.resultado.llamada.estado}`} className="text-[13px]">📞</span>}
                  {x.c.demo && <Badge k="demo" label="DEMO" />}
                </>
              ) : (
                <>
                  <span className="h-2 w-2 shrink-0 rounded-full border-2" style={{ borderColor: REP_DOT[x.r.tipo] }} />
                  <span className="min-w-0 flex-1 truncate" style={{ color: REP_DOT[x.r.tipo] }}>Nuevo reporte: {REP_TXT[x.r.tipo]}<span className="text-slate-300"> · Col. {x.r.colonia ?? "—"}</span></span>
                  {x.r.demo && <Badge k="demo" label="DEMO" />}
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* abajo-der: QR (Q oculta/muestra; el nodo no se desmonta para que el layout no se mueva) */}
      <div className="absolute bottom-6 right-6" data-testid="qr-wrap">
        <div className="glass flex items-center gap-4 p-3 pr-5 transition-opacity duration-200" style={{ opacity: qrOn ? 1 : 0, pointerEvents: qrOn ? "auto" : "none" }} data-testid="qr">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.qrSrc} alt="QR WhatsApp Sed" width={124} height={124} className="rounded-lg bg-white p-1.5" />
          <div className="max-w-[170px]">
            <div className="text-[17px] font-semibold leading-tight text-white">¿Hoy hay agua?</div>
            <div className="mt-1 text-[13px] leading-snug text-slate-300">Escanea y manda tu colonia o tu ubicación 📍</div>
            {p.qrNota && <div className="mt-1.5 text-[11.5px] leading-snug text-[#86efac]">{p.qrNota}</div>}
            {p.qrPlaceholder && <div className="mt-1.5 font-mono text-[10.5px] text-[#fde68a]">QR placeholder: corre pnpm qr</div>}
          </div>
        </div>
        <button onClick={toggleQr} aria-label={qrOn ? "Ocultar QR" : "Mostrar QR"} title={`${qrOn ? "Ocultar" : "Mostrar"} QR (Q)`}
          className={`absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md text-slate-200 transition-opacity hover:opacity-100 ${qrOn ? "opacity-50" : "opacity-35"}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />{!qrOn && <path d="M4 4l16 16" />}
          </svg>
        </button>
      </div>

      {/* toast WhatsApp */}
      {toast && (
        <div key={toast.id} className="os-toast glass absolute bottom-6 left-1/2 w-[560px] border-l-[3px] !border-l-[#22c55e] px-4 py-3">
          <div className="mb-1 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.2em] text-[#86efac]">
            <span>✓ Respuesta enviada por WhatsApp</span>{toast.demo && <Badge k="demo" label="DEMO" />}
          </div>
          <div className="whitespace-pre-line text-[14px] leading-snug text-slate-100">{toast.resultado.reply}</div>
        </div>
      )}
    </div>
  );
}
