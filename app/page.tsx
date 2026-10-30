import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-6 p-8 text-center">
      <p className="font-mono text-xs tracking-[0.3em] text-cian">SED // CDMX WATER OS</p>
      <h1 className="text-4xl font-semibold max-w-xl">Tu llave no avisa. Sed sí.</h1>
      <p className="text-slate-400 max-w-md">Por WhatsApp te dice en segundos si hay agua en tu colonia, cuándo llega y si hay un aviso de calidad, con fuente y fecha.</p>
      <div className="flex gap-3 font-mono text-sm">
        <Link className="rounded-lg border border-slate-700 px-4 py-2 hover:border-cian" href="/os">/os</Link>
        <Link className="rounded-lg border border-slate-700 px-4 py-2 hover:border-cian" href="/os?mock=1">/os?mock=1</Link>
        <Link className="rounded-lg border border-slate-700 px-4 py-2 hover:border-cian" href="/dev">/dev</Link>
      </div>
    </main>
  );
}
