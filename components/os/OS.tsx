"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConsultaPublica, Nivel } from "@/lib/types";
import type { Summary } from "@/lib/brain";
import { OsEngine, type Mode } from "./engine";
import { subscribe, broadcast, loadDemoEvents, fresh, type Status } from "./realtime";
import { Detail, MultiList, Badge } from "./Panel";

const DOT: Record<Nivel, string> = { verde: "#22c55e", ambar: "#f59e0b", rojo: "#ef4444", gris: "#64748b" };

export interface OSProps {
  styleUrl: string;
  satTiles?: string;
  mock: boolean;
  burst: number;
  every: number;
  qrSrc: string;
  qrPlaceholder: boolean;
  waNumber?: string;
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

export default function OS(p: OSProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const eng = useRef<OsEngine | null>(null);
  const demoEv = useRef<ConsultaPublica[]>([]);
  const demoIdx = useRef(0);
  const demoTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const multiTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [status, setStatus] = useState<{ s: Status; via: string }>({ s: "connecting", via: "" });
  const [mode, setMode] = useState<Mode>("idle");
  const [detail, setDetail] = useState<ConsultaPublica | null>(null);
  const [multi, setMulti] = useState<ConsultaPublica[]>([]);
  const [toast, setToast] = useState<ConsultaPublica | null>(null);
  const [ticker, setTicker] = useState<ConsultaPublica[]>([]);
  const [count, setCount] = useState(0);
  const [sat, setSat] = useState(false);
  const [demoOn, setDemoOn] = useState(false);
  const [offline, setOffline] = useState(false);
  const fitRef = useFit(`${detail?.id}-${multi.length}`);

  const ingest = useCallback((c: ConsultaPublica, o: { backfill: boolean }) => {
    const e = eng.current;
    if (!e) return;
    if (!e.push(c, { animate: !o.backfill })) return;
    setTicker((t) => [c, ...t].slice(0, 7));
    setCount((n) => n + 1);
  }, []);

  // motor + realtime
  useEffect(() => {
    if (!mapRef.current) return;
    const e = new OsEngine({
      container: mapRef.current,
      styleUrl: p.styleUrl,
      satTiles: p.satTiles,
      onReady: ({ offline }) => setOffline(offline),
      cb: {
        onMode: (m) => { setMode(m); if (m !== "multi") setMulti([]); if (m === "idle") setDetail(null); },
        onPanel: (c) => setDetail(c),
        onToast: (c) => setToast(c),
        onMulti: (l) => { setMulti(l); setDetail(l[0]); },
      },
    });
    eng.current = e;
    void e.start();
    (window as any).__sedEngine = e;
    const unsub = subscribe(ingest, (s, via) => setStatus({ s, via }));
    fetch("/api/brain/summary").then((r) => r.json()).then(setSummary).catch(() => {});
    return () => { unsub(); e.destroy(); eng.current = null; };
  }, [p.styleUrl, p.satTiles, ingest]);

  // toast: 6 s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(t);
  }, [toast]);

  // multi: rota detalle cada 3 s
  useEffect(() => {
    if (multiTimer.current) clearInterval(multiTimer.current);
    if (mode !== "multi" || multi.length < 2) return;
    let i = 0;
    multiTimer.current = setInterval(() => { i = (i + 1) % multi.length; setDetail(multi[i]); }, 3000);
    return () => { if (multiTimer.current) clearInterval(multiTimer.current); };
  }, [mode, multi]);

  // demo / mock
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
  const stopDemo = useCallback(() => { if (demoTimer.current) clearInterval(demoTimer.current); demoTimer.current = null; setDemoOn(false); }, []);
  const burst = useCallback(async (n: number) => {
    await ensureDemo();
    const ev = demoEv.current;
    for (let i = 0; i < n && ev.length; i++) { emit(ev[demoIdx.current % ev.length]); demoIdx.current++; }
  }, [ensureDemo, emit]);

  useEffect(() => {
    let t1: any, t2: any;
    if (p.mock || p.burst) {
      void ensureDemo();
      if (p.burst) t1 = setTimeout(() => void burst(p.burst), 2200);
      if (p.mock) t2 = setTimeout(() => void startDemo(), p.burst ? 16000 : 2200);
    }
    return () => { clearTimeout(t1); clearTimeout(t2); stopDemo(); };
  }, [p.mock, p.burst, ensureDemo, burst, startDemo, stopDemo]);

  // atajos del operador: D demo · B burst ×5 · I idle · S sat
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "d") (demoTimer.current ? stopDemo() : void startDemo());
      if (e.key === "b") void burst(5);
      if (e.key === "i") eng.current?.idleNow();
      if (e.key === "s" && p.satTiles) setSat((v) => !v);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [startDemo, stopDemo, burst, p.satTiles]);

  useEffect(() => { eng.current?.setSat(sat); }, [sat]);

  const live = status.s === "live" ? "LIVE" : status.s === "mock" ? "MOCK" : status.s === "connecting" ? "CONECTANDO" : "OFFLINE";
  const liveColor = status.s === "live" ? "#22c55e" : status.s === "mock" ? "#e879f9" : status.s === "connecting" ? "#f59e0b" : "#ef4444";

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
          <Clock /><span className="text-slate-600">|</span><span>{status.via || "—"}</span>
          {offline && <><span className="text-slate-600">|</span><span className="text-[#fde68a]">mapa offline</span></>}
          <span className="text-slate-600">|</span><span className="uppercase">{mode}</span>
        </div>
      </div>

      {/* arriba-der */}
      <div className="absolute right-6 top-6 flex items-center gap-2">
        {p.satTiles && (
          <div className="glass flex overflow-hidden p-0 font-mono text-[12px] font-bold tracking-widest">
            <button className={`px-3 py-2 ${!sat ? "bg-white/10 text-white" : "text-slate-400"}`} onClick={() => setSat(false)}>MAP</button>
            <button className={`px-3 py-2 ${sat ? "bg-white/10 text-white" : "text-slate-400"}`} onClick={() => setSat(true)}>SAT</button>
          </div>
        )}
        <div className="glass px-4 py-2 text-right">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">Consultas</div>
          <div className="font-mono text-[20px] font-bold leading-none text-white tabular-nums">{count}</div>
        </div>
        <button onClick={() => (demoOn ? stopDemo() : void startDemo())} className={`glass px-4 py-3 font-mono text-[12px] font-bold tracking-widest ${demoOn ? "text-[#e879f9] ring-1 ring-[#e879f9]/60" : "text-slate-200 hover:text-white"}`}>
          {demoOn ? "■ DEMO" : "▶ DEMO"}
        </button>
        <button onClick={() => void burst(5)} title="5 consultas a la vez (B)" className="glass px-3 py-3 font-mono text-[12px] font-bold tracking-widest text-slate-300 hover:text-white">×5</button>
      </div>

      {/* derecha: panel */}
      <aside ref={fitRef.outer} className={`glass os-panel absolute bottom-[186px] right-6 top-[92px] w-[520px] overflow-hidden px-5 py-4 transition-[opacity,transform] duration-500 ${detail || multi.length ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-6 opacity-0"}`}>
        <div ref={fitRef.inner} className="origin-top-left">
          {mode === "multi" && multi.length > 0 && (
            <div className="mb-3 border-b border-white/8 pb-3"><MultiList list={multi} active={detail?.id ?? null} /></div>
          )}
          {detail && <Detail key={detail.id} c={detail} s={summary} compact={mode === "multi"} />}
        </div>
      </aside>

      {/* abajo-izq: ticker */}
      <div className="glass absolute bottom-6 left-6 w-[460px] px-4 py-3">
        <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.2em] text-slate-400">Últimas consultas</div>
        {ticker.length === 0 && <div className="font-mono text-[12.5px] text-slate-500">Esperando consultas… escanea el QR</div>}
        <div className="flex flex-col gap-1">
          {ticker.map((c) => (
            <div key={c.id} className="os-tick flex items-center gap-2 font-mono text-[12.5px]">
              <span className="text-slate-500 tabular-nums">{new Date(c.created_at).toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City", hour12: false })}</span>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: DOT[c.nivel], boxShadow: `0 0 6px ${DOT[c.nivel]}` }} />
              <span className="min-w-0 flex-1 truncate text-slate-100">{c.colonia ?? "—"}<span className="text-slate-500"> · {c.alcaldia}</span></span>
              {c.demo && <Badge k="demo" label="DEMO" />}
            </div>
          ))}
        </div>
      </div>

      {/* abajo-der: QR */}
      <div className="glass absolute bottom-6 right-6 flex items-center gap-4 p-3 pr-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.qrSrc} alt="QR WhatsApp Sed" width={124} height={124} className="rounded-lg bg-white p-1.5" />
        <div className="max-w-[170px]">
          <div className="text-[17px] font-semibold leading-tight text-white">¿Hoy hay agua?</div>
          <div className="mt-1 text-[13px] leading-snug text-slate-300">Escanea y manda tu colonia o tu ubicación 📍</div>
          {p.qrPlaceholder && <div className="mt-1.5 font-mono text-[10.5px] text-[#fde68a]">QR placeholder: corre pnpm qr</div>}
        </div>
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
