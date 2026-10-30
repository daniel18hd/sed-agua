// Panel de atención (lectura): casos activos + archivados de 24 h, reportes en la ventana y contadores. Archiva lo que volvió a normal.
import { NextResponse } from "next/server";
import { panel } from "@/lib/atencion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await panel(), { headers: { "Cache-Control": "no-store" } });
}
