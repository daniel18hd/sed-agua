// El funcionario cambia el estado de atención: nuevo → en_revision → atendido. Queda en el historial del caso.
// Si OPS_KEY está definida, se exige en el header x-ops-key.
import { NextResponse } from "next/server";
import { cambiarAtencion } from "@/lib/atencion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (process.env.OPS_KEY && req.headers.get("x-ops-key") !== process.env.OPS_KEY) return NextResponse.json({ error: "OPS_KEY requerida" }, { status: 401 });
  const { id } = await ctx.params;
  const b = await req.json().catch(() => ({}));
  if (!["nuevo", "en_revision", "atendido"].includes(b.atencion)) return NextResponse.json({ error: "atencion inválida" }, { status: 400 });
  const r = await cambiarAtencion(id, b.atencion, typeof b.nota === "string" ? b.nota.slice(0, 200) : undefined);
  return "error" in r ? NextResponse.json(r, { status: 409 }) : NextResponse.json(r);
}
