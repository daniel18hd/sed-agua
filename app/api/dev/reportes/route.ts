// DEMO de discrepancias: simula reportes [DEMO] de vecinos distintos en Agrícola Oriental (estado oficial normal).
// POST {hasta: 3|5} crea UN reporte si la zona tiene menos de `hasta` (el OS lo llama en bucle para verlo en vivo).
// POST {reset: true} archiva el caso demo y borra los reportes demo. Solo con DEMO_SCENARIOS=1 o fuera de producción.
import { NextResponse } from "next/server";
import { registrarReporte, evaluarZona, zonaDemo } from "@/lib/atencion";
import { sb, mem, casoActivo, guardarCaso } from "@/lib/store";
import { zonaKey } from "@/brain/rules/discrepancia.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const permitido = () => process.env.DEMO_SCENARIOS === "1" || process.env.NODE_ENV !== "production";

export async function POST(req: Request) {
  if (!permitido()) return NextResponse.json({ error: "solo en modo demo (DEMO_SCENARIOS=1)" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const z = zonaDemo();
  if (b.reset) {
    const client = sb();
    if (client) {
      await client.from("reportes").delete().eq("demo", true).eq("cve_col", z.cve_col!);
      await client.from("reportes_publicos").delete().eq("demo", true).eq("cve_col", z.cve_col!);
    } else {
      mem.reportes = mem.reportes.filter((r) => !(r.demo && r.cve_col === z.cve_col));
      mem.reportesPub = mem.reportesPub.filter((r) => !(r.demo && r.cve_col === z.cve_col));
    }
    const c = await casoActivo(zonaKey(z));
    if (c) await guardarCaso({ zona_key: c.zona_key, archivado: true, archivado_at: new Date().toISOString(), archivado_motivo: "reinicio de demo", historial: [...c.historial, { at: new Date().toISOString(), nota: "reinicio de demo" }] }, c.id);
    return NextResponse.json({ ok: true });
  }
  const hasta = Math.min(10, Math.max(1, Number(b.hasta) || 3));
  const antes = await evaluarZona(z, { demo: true });
  if (antes.disc.n >= hasta) return NextResponse.json({ n: antes.disc.n, estado: antes.disc.estado, caso: antes.caso });
  const j = () => (Math.random() - 0.5) * 0.004; // ±200 m dentro de la colonia
  const r = await registrarReporte({
    phone_hash: `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    tipo: "sin_agua", loc: { ...z, lat: z.lat + j(), lon: z.lon + j() }, demo: true,
  });
  return NextResponse.json({ n: r.disc.n, estado: r.disc.estado, folio: r.folio, caso: r.caso });
}
