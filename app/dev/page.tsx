"use client";
import { useEffect, useRef, useState } from "react";

interface Entrada { id: string; label: string; alcaldia: string; tipo: string; demo: boolean; texto: string; lat: number; lon: number; coord_nota?: string }
interface Msg { dir: "in" | "out"; text: string; meta?: string }

const RELOJES = [
  { v: "2026-10-29T09:00-06:00", t: "Demo · 29 oct 09:00 (aviso CTM vigente)" },
  { v: "2026-10-31T09:00-06:00", t: "31 oct 09:00 (aviso CTM vencido)" },
  { v: "", t: "Hora real (o DEMO_NOW del servidor)" },
];

export default function Dev() {
  const [entradas, setEntradas] = useState<Entrada[]>([]);
  const [log, setLog] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [now, setNow] = useState(RELOJES[0].v);
  const [demo, setDemo] = useState(true);
  const [from, setFrom] = useState("whatsapp:+5215512345678");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { fetch("/api/dev/simulate").then((r) => r.json()).then((j) => setEntradas(j.entradas)); }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [log]);

  async function send(body: Record<string, unknown>, shown: string) {
    setBusy(true);
    setLog((l) => [...l, { dir: "in", text: shown }]);
    try {
      const r = await fetch(`/api/dev/simulate${location.search}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ From: from, now: now || undefined, demo, ...body }) });
      const j = await r.json();
      const meta = [j.kind, j.ms != null && `${j.ms} ms`, j.consulta && `${j.consulta.colonia ?? "—"}, ${j.consulta.alcaldia} · ${j.consulta.nivel}`].filter(Boolean).join(" · ");
      setLog((l) => [...l, { dir: "out", text: j.reply ?? j.error ?? "(sin respuesta)", meta }]);
    } catch (e) {
      setLog((l) => [...l, { dir: "out", text: `Error: ${(e as Error).message}` }]);
    } finally { setBusy(false); }
  }

  const btn = "rounded-lg border border-slate-700 px-3 py-1.5 text-left text-[13px] hover:border-[#38bdf8] disabled:opacity-40";
  return (
    <main className="mx-auto grid min-h-dvh max-w-6xl grid-cols-1 gap-6 p-6 lg:grid-cols-[1fr_420px]">
      <section className="flex flex-col gap-5">
        <header>
          <p className="font-mono text-xs tracking-[0.3em] text-[#38bdf8]">SED // DEV</p>
          <h1 className="text-2xl font-semibold">Simulador de WhatsApp</h1>
          <p className="text-sm text-slate-400">Pasa por el mismo router que el webhook de Twilio y publica la consulta al OS (abre <a className="underline" href="/os" target="_blank">/os</a> en otra pestaña). No manda mensajes reales.</p>
        </header>

        <div className="grid gap-3 rounded-xl border border-slate-800 p-4 sm:grid-cols-3">
          <label className="text-xs text-slate-400 sm:col-span-2">Reloj (DEMO_NOW)
            <select value={now} onChange={(e) => setNow(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100">
              {RELOJES.map((r) => <option key={r.t} value={r.v}>{r.t}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400">Número (se hashea)
            <input value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-sm text-slate-100" />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300 sm:col-span-3">
            <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} /> Aplicar escenarios [DEMO] (azufre en Agrícola Oriental, fuga sin fin en Sta. Úrsula)
          </label>
        </div>

        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { void send({ Body: text }, text); setText(""); } }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder='Dirección, colonia + alcaldía, CP (03100), "Hola" o "REPORTAR"' className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm" />
          <button disabled={busy} className="rounded-lg bg-[#38bdf8] px-4 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50">Enviar</button>
        </form>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (lat && lon) void send({ Latitude: lat, Longitude: lon }, `📍 ${lat}, ${lon}`); }}>
          <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="lat 19.386" className="w-32 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm" />
          <input value={lon} onChange={(e) => setLon(e.target.value)} placeholder="lon -99.143" className="w-32 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm" />
          <button disabled={busy} className={btn}>Enviar ubicación 📍</button>
          <button type="button" disabled={busy} className={btn} onClick={() => void send({ Body: "", NumMedia: "1" }, "🖼️ (imagen)")}>Simular imagen</button>
          <button type="button" disabled={busy} className={btn} onClick={() => void send({ Body: "REPORTAR" }, "REPORTAR")}>REPORTAR</button>
          {["1", "2", "3"].map((n) => <button key={n} type="button" disabled={busy} className={btn} onClick={() => void send({ Body: n }, n)}>{n}</button>)}
        </form>

        <div>
          <h2 className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-slate-400">Casos demo (coordenadas del caso)</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {entradas.map((e) => (
              <div key={e.id} className="flex gap-1">
                <button disabled={busy} className={`${btn} flex-1 ${e.demo ? "border-[#e879f9]/60" : ""}`} onClick={() => void send({ casoId: e.id }, `[${e.id}] ${e.texto}`)}>
                  <span className="block font-medium text-slate-100">{e.label}</span>
                  <span className="block text-[11px] text-slate-400">{e.alcaldia} · {e.tipo}{e.coord_nota ? " · sin coord" : ""}</span>
                </button>
                <button title="Enviar como texto (geocodifica)" disabled={busy} className={`${btn} px-2`} onClick={() => void send({ Body: e.texto }, e.texto)}>Aa</button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="flex h-[calc(100dvh-3rem)] flex-col rounded-2xl border border-slate-800 bg-[#0b141a]">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <span className="text-sm font-semibold">Sed · WhatsApp (simulado)</span>
          <button className="text-xs text-slate-400 hover:text-white" onClick={() => setLog([])}>limpiar</button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {log.map((m, i) => (
            <div key={i} className={`max-w-[88%] whitespace-pre-line rounded-xl px-3 py-2 text-[13.5px] leading-snug ${m.dir === "in" ? "ml-auto bg-[#005c4b]" : "bg-[#202c33]"}`}>
              {m.text}
              {m.meta && <div className="mt-1 font-mono text-[10px] text-slate-400">{m.meta}</div>}
            </div>
          ))}
          <div ref={end} />
        </div>
      </section>
    </main>
  );
}
