import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import OS from "@/components/os/OS";

export const metadata: Metadata = { title: "SED // CDMX WATER OS" };

const DEFAULT_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const hasQR = fs.existsSync(path.join(process.cwd(), "public", "qr.png"));
  let qrInfo: { numero: string; texto: string; sandbox: boolean } | null = null;
  try { qrInfo = JSON.parse(fs.readFileSync(path.join(process.cwd(), "public", "qr.json"), "utf8")); } catch {}
  return (
    <OS
      styleUrl={process.env.NEXT_PUBLIC_MAP_STYLE || DEFAULT_STYLE}
      satTiles={process.env.NEXT_PUBLIC_SAT_TILES || undefined}
      mock={sp.mock === "1"}
      burst={Math.min(20, Number(sp.burst) || 0)}
      every={Math.max(1, Number(sp.every) || 15)}
      idleMin={Math.max(1, Number(sp.idle) || Number(process.env.OS_IDLE_MIN) || 10)}
      demoScenarios={process.env.DEMO_SCENARIOS === "1"}
      qrSrc={hasQR ? "/qr.png" : "/qr-demo.png"}
      qrPlaceholder={!hasQR}
      qrNota={qrInfo?.sandbox ? `Se abre WhatsApp con «${qrInfo.texto}»: envíalo y luego manda tu colonia` : undefined}
    />
  );
}
