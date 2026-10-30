import { NextResponse } from "next/server";
import { summary } from "@/lib/brain";

export const runtime = "nodejs";
export const revalidate = 3600;

export function GET() {
  return NextResponse.json(summary(), { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
