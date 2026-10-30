// SSE del bus en memoria (fallback sin Supabase). En Vercel serverless solo vive mientras la función esté caliente;
// para la demo en Vercel usa Supabase Realtime o /os?mock=1.
import { subscribeMem, backfillMem, subscribeBus } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const enc = new TextEncoder();
  let unsub = () => {};
  let hb: ReturnType<typeof setInterval>;
  const stream = new ReadableStream({
    start(ctl) {
      const send = (ev: string, d: unknown) => ctl.enqueue(enc.encode(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`));
      send("backfill", backfillMem());
      const u1 = subscribeMem((c) => send("consulta", c)) as () => void;
      const u2 = subscribeBus((e) => send(e.type, e.data)) as () => void;
      unsub = () => { u1(); u2(); };
      hb = setInterval(() => ctl.enqueue(enc.encode(`: hb\n\n`)), 15000);
      req.signal.addEventListener("abort", () => { unsub(); clearInterval(hb); try { ctl.close(); } catch {} });
    },
    cancel() { unsub(); clearInterval(hb); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
