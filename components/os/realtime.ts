// Fuente de eventos del OS. Supabase Realtime (postgres_changes en consultas_publicas) si hay env pública;
// si no, SSE del bus en memoria (/api/stream). En ambos casos: BroadcastChannel entre pestañas (mock/Demo de otra pestaña).
import type { ConsultaPublica } from "@/lib/types";

export type Status = "connecting" | "live" | "offline" | "mock";
type OnEvent = (c: ConsultaPublica, o: { backfill: boolean }) => void;

const BC = "sed-os";

export function subscribe(onEvent: OnEvent, onStatus: (s: Status, via: string) => void): () => void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const cleanups: (() => void)[] = [];

  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel(BC);
    bc.onmessage = (e) => e.data?.type === "consulta" && onEvent(e.data.c, { backfill: false });
    cleanups.push(() => bc?.close());
  } catch {}

  if (url && anon) {
    let closed = false;
    (async () => {
      const { createClient } = await import("@supabase/supabase-js");
      if (closed) return;
      const sb = createClient(url, anon, { auth: { persistSession: false }, realtime: { params: { eventsPerSecond: 20 } } });
      const backfill = async () => {
        const since = new Date(Date.now() - 120_000).toISOString();
        const { data } = await sb.from("consultas_publicas").select("*").gte("created_at", since).order("created_at", { ascending: true }).limit(50);
        for (const c of (data ?? []) as ConsultaPublica[]) onEvent(c, { backfill: true });
      };
      const ch = sb
        .channel("os")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "consultas_publicas" }, (p) => onEvent(p.new as ConsultaPublica, { backfill: false }))
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "consultas_publicas" }, (p) => onEvent(p.new as ConsultaPublica, { backfill: false }))
        .subscribe((st) => {
          if (st === "SUBSCRIBED") { onStatus("live", "supabase"); void backfill(); } // también tras reconectar
          else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") onStatus("offline", "supabase");
        });
      cleanups.push(() => { closed = true; void sb.removeChannel(ch); });
    })();
    cleanups.push(() => { closed = true; });
  } else {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    const open = () => {
      es = new EventSource("/api/stream");
      es.addEventListener("backfill", (e) => { onStatus("live", "sse"); for (const c of JSON.parse((e as MessageEvent).data)) onEvent(c, { backfill: true }); });
      es.addEventListener("consulta", (e) => onEvent(JSON.parse((e as MessageEvent).data), { backfill: false }));
      es.onerror = () => { onStatus("offline", "sse"); if (es?.readyState === EventSource.CLOSED) { retry = setTimeout(open, 2000); } };
    };
    open();
    cleanups.push(() => { es?.close(); clearTimeout(retry); });
  }
  onStatus("connecting", url && anon ? "supabase" : "sse");
  return () => cleanups.forEach((f) => f());
}

/** Emite un evento local (mock/Demo) y lo comparte con otras pestañas. */
export function broadcast(c: ConsultaPublica) {
  try { const bc = new BroadcastChannel(BC); bc.postMessage({ type: "consulta", c }); bc.close(); } catch {}
}

/** Eventos demo precalculados por el servidor; se guardan en localStorage para seguir funcionando sin red. */
export async function loadDemoEvents(): Promise<ConsultaPublica[]> {
  const KEY = "sed-demo-eventos-v1";
  try {
    const r = await fetch("/api/demo", { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    const { eventos } = await r.json();
    try { localStorage.setItem(KEY, JSON.stringify(eventos)); } catch {}
    return eventos;
  } catch {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
  }
}

export const fresh = (c: ConsultaPublica): ConsultaPublica => ({
  ...c,
  id: `${c.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  created_at: new Date().toISOString(),
});
