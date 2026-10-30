// Motor del OS: MapLibre (globo) + deck.gl interleaved + UNA cámara con cola serializada.
// Estabilidad: los eventos se agrupan en ventanas de 1.5 s (coalescencia) → un solo trabajo de cámara; nunca hay dos
// movimientos a la vez (se cancela limpio con map.stop()); easing sin rebote; tolerancia mínima antes de re-encuadrar;
// los datos de las capas son referencias estables (no se recrean por evento) y las alcaldías usan feature-state.
// Todo el estado de animación vive aquí (fuera de React). React solo recibe callbacks del HUD/panel.
import maplibregl, { type Map as MLMap, type StyleSpecification, type LngLatBoundsLike } from "maplibre-gl";
import type { ConsultaPublica, Nivel } from "@/lib/types";
import type { ReportePublico, CasoAtencion } from "@/lib/store";

export type Mode = "idle" | "single" | "multi" | "caso";
type RGB = [number, number, number];
type LngLat = [number, number];

export const HEX: Record<Nivel, string> = { verde: "#22c55e", ambar: "#f59e0b", rojo: "#ef4444", gris: "#64748b" };
const RGBN: Record<Nivel, RGB> = { verde: [34, 197, 94], ambar: [245, 158, 11], rojo: [239, 68, 68], gris: [100, 116, 139] };
const CIAN: RGB = [56, 189, 248];
export const CASO_HEX: Record<string, string> = { posible_problema: "#fb923c", alerta: "#ff2e88", explicado: "#94a3b8", aislado: "#60a5fa" };
const REP_RGB: Record<string, RGB> = { sin_agua: [251, 146, 60], baja_presion: [250, 204, 21], mala_calidad: [167, 139, 250] };

const IDLE = { center: [-101.2, 21.8] as LngLat, zoom: 2.35, pitch: 0, bearing: 0 };
const COALESCE = 1500;         // ventana de coalescencia de eventos → un solo re-encuadre
const DEFAULT_IDLE = 10 * 60_000; // reposo tras X min sin eventos (configurable); nunca borra puntos ni paneles
const MAX_POINTS = 600;
const AGE_FADE = 30 * 60_000;
const PULSE_MS = 4000;         // pulso corto de los puntos que no son el principal
const MULTI_POINTS_WINDOW = 3 * 60_000;
const SWAY_DEG = 6;
const SWAY_PERIOD = 48_000;
const TRIP_DRAW = 3000;        // la línea de agua se dibuja del origen al punto exacto
const TRIP_DUR = 2500;
const TRIP_TRAIL = 1600;
const TRIP_CYCLE = TRIP_DUR + TRIP_TRAIL + 400;
const DWELL = 3500;
const PANEL_W = 540;
const LEFT_W = 420;             // columna izquierda: casos que requieren atención
const OFFSET: [number, number] = [-(PANEL_W - LEFT_W) / 2, 20]; // centro del hueco entre la columna izquierda y el panel
const PAD = { top: 150, bottom: 230, left: LEFT_W + 60, right: PANEL_W + 100 };
const EASE = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); // cúbica in-out: sin rebote

const NODOS: Record<string, string> = {
  presa_valle_de_bravo: "Presa Valle de Bravo", presa_villa_victoria: "Presa Villa Victoria", presa_el_bosque: "Presa El Bosque",
  planta_los_berros: "Planta Los Berros", entrada_poniente_cdmx: "Entrada poniente", norte_chalmita: "Tanques Chalmita", oriente_la_caldera: "Acueducto La Caldera",
};

interface Pt { c: ConsultaPublica; t: number; arr: number; pos: LngLat; nivel: Nivel }
interface Rep { r: ReportePublico; arr: number; pos: LngLat; rgb: RGB }
interface Ruta { orig: LngLat; nombre: string; sistema: string; local: boolean; path: LngLat[]; nodos: { id: string; pos: LngLat }[] }
interface Trip { path: LngLat[]; timestamps: number[]; colors: number[][]; nivel: Nivel }
interface RutaFeature { type: "Feature"; geometry: { type: "LineString" | "Point"; coordinates: any }; properties: { id?: string; tipo?: string; cve_mun?: string; sistema?: string } }
type Job = { kind: "consulta"; principal: Pt; otros: Pt[] } | { kind: "caso"; caso: CasoAtencion };

export interface EngineCallbacks {
  onMode?: (m: Mode) => void;
  onPanel?: (c: ConsultaPublica) => void;
  onToast?: (c: ConsultaPublica) => void;
  onMulti?: (list: ConsultaPublica[], principal: ConsultaPublica) => void;
  onCasoFoco?: (c: CasoAtencion) => void;
  onReset?: () => void;
}
export interface EngineInit { container: HTMLElement; styleUrl: string; satTiles?: string; idleAfterMs?: number; cb: EngineCallbacks; onReady?: (info: { offline: boolean }) => void }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

async function loadStyle(url: string): Promise<{ style: StyleSpecification | string; offline: boolean }> {
  const offline: StyleSpecification = {
    version: 8,
    sources: { land: { type: "geojson", data: "/offline/land-110m.geojson" }, borders: { type: "geojson", data: "/offline/borders-110m.geojson" } },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#070b12" } },
      { id: "land", type: "fill", source: "land", paint: { "fill-color": "#0e1622" } },
      { id: "borders", type: "line", source: "borders", paint: { "line-color": "#1e2a3a", "line-width": 0.7 } },
    ],
  };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error(String(r.status));
    return { style: (await r.json()) as StyleSpecification, offline: false };
  } catch (e) {
    console.warn("[os] estilo remoto no disponible, uso estilo offline:", (e as Error).message);
    return { style: offline, offline: true };
  }
}

function densify(coords: LngLat[], n = 90): LngLat[] {
  const seg: number[] = [0];
  for (let i = 1; i < coords.length; i++) seg.push(seg[i - 1] + Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]));
  const total = seg[seg.length - 1] || 1;
  const out: LngLat[] = [];
  for (let k = 0; k <= n; k++) {
    const d = (k / n) * total;
    let i = 1;
    while (i < seg.length - 1 && seg[i] < d) i++;
    const t = (d - seg[i - 1]) / (seg[i] - seg[i - 1] || 1);
    out.push([lerp(coords[i - 1][0], coords[i][0], t), lerp(coords[i - 1][1], coords[i][1], t)]);
  }
  return out;
}
function bboxOf(pts: LngLat[], pad = 0): [LngLat, LngLat] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [[x0 - pad, y0 - pad], [x1 + pad, y1 + pad]];
}
const RANK: Record<Nivel, number> = { gris: 0, verde: 1, ambar: 2, rojo: 3 };

export class OsEngine {
  map!: MLMap;
  private cb: EngineCallbacks;
  private overlay: any = null;
  private deck: any = null;
  private deckLoading: Promise<void> | null = null;
  private mode: Mode = "idle";
  private points: Pt[] = [];
  private reps: Rep[] = [];
  private seen = new Set<string>();
  private pending: Pt[] = [];
  private jobs: Job[] = [];
  private coalesceT: any = null;
  private idleT: any = null;
  private gen = 0;
  private runningGen = -1;
  private rotating = true;
  private swayT0 = 0;
  private alc = new Map<string, { nivel: Nivel; k: number; target: number }>();
  private alcLabel = new Map<string, LngLat>();
  private ruta: RutaFeature[] = [];
  private route: Ruta | null = null;
  private trips: Trip[] = [];
  private tripT0 = 0;
  private focus: Pt | null = null;
  private focusT = 0;
  private casos: CasoAtencion[] = [];
  private casoFoco: string | null = null;
  private colGeo = new Map<string, any>();
  private markers: maplibregl.Marker[] = [];
  private raf = 0;
  private lastFrame = 0;
  private lastCasoPaint = 0;
  private dataV = 0;      // sube cuando cambian puntos/reportes (para no reconstruir datos cada frame)
  private destroyed = false;
  private idleAfter: number;
  private camMoves = 0;
  ready = false;

  constructor(private init: EngineInit) {
    this.cb = init.cb;
    this.idleAfter = init.idleAfterMs ?? DEFAULT_IDLE;
  }

  async start() {
    const geoP = Promise.all([fetch("/api/brain/geo?f=alcaldias").then((r) => r.json()), fetch("/api/brain/geo?f=ruta").then((r) => r.json())]);
    const { style, offline } = await loadStyle(this.init.styleUrl);
    if (this.destroyed) return;
    const map = new maplibregl.Map({
      container: this.init.container, style, center: IDLE.center, zoom: IDLE.zoom, pitch: 0, maxPitch: 70,
      attributionControl: { compact: true }, pixelRatio: Math.min(window.devicePixelRatio || 1, 2), fadeDuration: 0,
      canvasContextAttributes: { antialias: true },
    } as any);
    this.map = map;
    let styled = false;
    const styleP = new Promise<void>((res) => {
      const done = () => { if (!styled) { styled = true; this.onStyle(offline); res(); } };
      map.once("style.load", done);
      map.once("load", done);
      if (map.isStyleLoaded()) done();
    });
    // El usuario puede arrastrar el mapa: eso cancela la secuencia en curso de forma limpia (sin pelear con la cámara).
    map.on("dragstart", () => { this.rotating = false; });
    this.loop(performance.now());
    const [[alcGeo, rutaGeo]] = await Promise.all([geoP, styleP]);
    if (this.destroyed) return;
    this.ruta = rutaGeo.features;
    for (const f of alcGeo.features) this.alcLabel.set(f.properties.cve_mun, [f.properties.label_lon, f.properties.label_lat]);
    this.addOwnLayers(alcGeo);
    this.ready = true;
    this.init.onReady?.({ offline });
    for (const f of this.readyQ.splice(0)) f();
  }

  private readyQ: (() => void)[] = [];
  private whenReady(fn: () => void) { if (this.ready) fn(); else this.readyQ.push(fn); }

  private onStyle(offline: boolean) {
    const m = this.map;
    m.setProjection({ type: "globe" });
    m.setSky({
      "sky-color": "#05070b", "horizon-color": "#0c2a4a", "fog-color": "#05070b", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.4, "fog-ground-blend": 0.85,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 6, 0.6, 9, 0],
    } as any);
    if (!offline) for (const l of m.getStyle().layers ?? []) if (l.type === "background") m.setPaintProperty(l.id, "background-color", "#05070b");
    if (this.init.satTiles) {
      m.addSource("sat", { type: "raster", tiles: [this.init.satTiles], tileSize: 256, attribution: "Imagen satelital: ver NEXT_PUBLIC_SAT_TILES" });
      m.addLayer({ id: "sat", type: "raster", source: "sat", layout: { visibility: "none" }, paint: { "raster-opacity": 0.85, "raster-saturation": -0.3, "raster-brightness-max": 0.75 } }, this.firstSymbol());
    }
  }
  private firstSymbol() { return this.map.getStyle().layers?.find((l) => l.type === "symbol")?.id; }

  private addOwnLayers(alcGeo: unknown) {
    const m = this.map;
    if (m.getSource("alcaldias")) return;
    m.addSource("alcaldias", { type: "geojson", data: alcGeo as any, promoteId: "cve_mun" });
    const before = this.firstSymbol();
    const k = ["coalesce", ["feature-state", "k"], 0] as any;
    const nivelColor = ["match", ["coalesce", ["feature-state", "nivel"], "gris"], "verde", HEX.verde, "ambar", HEX.ambar, "rojo", HEX.rojo, HEX.gris] as any;
    m.addLayer({ id: "alc-fill", type: "fill", source: "alcaldias", paint: { "fill-color": nivelColor, "fill-opacity": ["*", 0.12, k] } }, before);
    m.addLayer({ id: "alc-base", type: "line", source: "alcaldias", paint: { "line-color": "#64748b", "line-opacity": 0.38, "line-width": 0.8 } }, before);
    m.addLayer({ id: "alc-glow", type: "line", source: "alcaldias", paint: { "line-color": nivelColor, "line-opacity": ["*", 0.6, k], "line-width": 9, "line-blur": 6 } }, before);
    m.addLayer({ id: "alc-line", type: "line", source: "alcaldias", paint: { "line-color": nivelColor, "line-opacity": k, "line-width": 3 } }, before);
    // Zonas que requieren atención (contorno de colonia en color de alerta). Se actualiza con setData.
    m.addSource("casos", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    const cc = ["match", ["get", "estado"], "alerta", CASO_HEX.alerta, "posible_problema", CASO_HEX.posible_problema, CASO_HEX.explicado] as any;
    m.addLayer({ id: "caso-fill", type: "fill", source: "casos", paint: { "fill-color": cc, "fill-opacity": 0.14 } }, before);
    m.addLayer({ id: "caso-glow", type: "line", source: "casos", paint: { "line-color": cc, "line-opacity": 0.7, "line-width": 12, "line-blur": 8 } }, before);
    m.addLayer({ id: "caso-line", type: "line", source: "casos", paint: { "line-color": cc, "line-width": 3, "line-dasharray": [2, 1] } }, before);
  }

  setSat(on: boolean) { if (this.map?.getLayer("sat")) this.map.setLayoutProperty("sat", "visibility", on ? "visible" : "none"); }

  // ------------------------------------------------------------------ entrada de eventos
  /** Consulta nueva. Devuelve false si es duplicada. */
  push(c: ConsultaPublica, opt: { animate?: boolean } = {}): boolean {
    if (this.seen.has(c.id)) return false;
    this.seen.add(c.id);
    const t = Date.parse(c.created_at) || Date.now();
    const pt: Pt = { c, t: Math.min(t, Date.now()), arr: performance.now(), pos: [c.lon, c.lat], nivel: c.nivel };
    this.points.push(pt);
    if (this.points.length > MAX_POINTS) this.points.splice(0, this.points.length - MAX_POINTS);
    this.dataV++;
    this.ensureDeck();
    if (opt.animate === false) { pt.arr = -1e9; return true; }
    clearTimeout(this.idleT);
    this.pending.push(pt);
    if (!this.coalesceT) this.coalesceT = setTimeout(() => this.flush(), COALESCE); // ventana fija desde el 1er evento
    return true;
  }

  /** Reporte de vecino: punto + pulso, sin mover la cámara. */
  pushReporte(r: ReportePublico, opt: { animate?: boolean } = {}): boolean {
    const id = `rep:${r.id}`;
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.reps.push({ r, arr: opt.animate === false ? -1e9 : performance.now(), pos: [r.lon, r.lat], rgb: REP_RGB[r.tipo] ?? REP_RGB.sin_agua });
    if (this.reps.length > MAX_POINTS) this.reps.splice(0, this.reps.length - MAX_POINTS);
    this.dataV++;
    this.ensureDeck();
    return true;
  }

  /** Lista de casos activos (contornos). Si `foco`, la cámara va a esa zona usando la misma cola. */
  setCasos(casos: CasoAtencion[], foco?: CasoAtencion) {
    this.casos = casos.filter((c) => !c.archivado);
    void this.paintCasos();
    if (foco) {
      clearTimeout(this.idleT);
      this.jobs = this.jobs.filter((j) => !(j.kind === "caso" && j.caso.zona_key === foco.zona_key));
      this.jobs.unshift({ kind: "caso", caso: foco }); // prioridad: va justo después del trabajo en curso
      this.whenReady(() => this.kick());
    }
  }

  private async paintCasos() {
    const feats: any[] = [];
    for (const c of this.casos) {
      if (c.estado === "aislado") continue;
      let g = c.cve_col ? this.colGeo.get(c.cve_col) : null;
      if (c.cve_col && g === undefined) {
        try { const r = await fetch(`/api/brain/geo?f=colonia&cve=${c.cve_col}`); g = r.ok ? await r.json() : null; } catch { g = null; }
        this.colGeo.set(c.cve_col, g);
      }
      const geometry = g?.geometry ?? circle([c.lon, c.lat], 0.5);
      feats.push({ type: "Feature", geometry, properties: { id: c.id, estado: c.estado } });
    }
    const src = this.map?.getSource("casos") as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features: feats });
  }

  private flush() {
    this.coalesceT = null;
    if (!this.ready) { this.whenReady(() => this.flush()); return; }
    const batch = this.pending.splice(0);
    if (!batch.length) return;
    // principal = el más grave; empate → el más reciente
    const principal = [...batch].sort((a, b) => RANK[b.nivel] - RANK[a.nivel] || b.t - a.t)[0];
    this.jobs.push({ kind: "consulta", principal, otros: batch.filter((p) => p !== principal) });
    // Si se acumulan trabajos (ráfagas seguidas), se funden en uno multi-punto: nunca hay una fila larga de vuelos.
    const cons = this.jobs.filter((j) => j.kind === "consulta") as Extract<Job, { kind: "consulta" }>[];
    if (cons.length >= 2) {
      const todos = cons.flatMap((j) => [j.principal, ...j.otros]);
      const p = [...todos].sort((a, b) => RANK[b.nivel] - RANK[a.nivel] || b.t - a.t)[0];
      this.jobs = [...this.jobs.filter((j) => j.kind === "caso"), { kind: "consulta", principal: p, otros: todos.filter((x) => x !== p) }];
    }
    this.kick();
  }

  private kick() {
    if (this.runningGen === this.gen) return;
    void this.runner(this.gen);
  }

  private async runner(g: number) {
    this.runningGen = g;
    try {
      while (g === this.gen && this.jobs.length) {
        const job = this.jobs.shift()!;
        if (job.kind === "caso") await this.runCaso(job.caso, g);
        else await this.runConsulta(job.principal, job.otros, g);
      }
    } finally {
      if (this.runningGen === g) { this.runningGen = -1; if (g === this.gen) this.armIdle(); }
    }
  }

  private armIdle() {
    clearTimeout(this.idleT);
    this.idleT = setTimeout(() => void this.goIdle(), this.idleAfter);
  }

  // ------------------------------------------------------------------ cámara (una sola activa)
  private wait(ms: number, g: number) { return new Promise<boolean>((r) => setTimeout(() => r(g === this.gen && !this.destroyed), ms)); }

  private cam(g: number, go: (m: MLMap) => void, ms: number): Promise<boolean> {
    if (g !== this.gen || this.destroyed) return Promise.resolve(false);
    const m = this.map;
    if (m.isMoving()) m.stop(); // cancelación limpia; nunca dos movimientos encimados
    this.rotating = false;
    this.camMoves++;
    return new Promise<boolean>((res) => {
      let done = false;
      const fin = () => { if (done) return; done = true; m.off("moveend", fin); clearTimeout(t); res(g === this.gen && !this.destroyed); };
      const t = setTimeout(fin, ms + 900);
      m.on("moveend", fin);
      go(m);
    });
  }

  private fly(g: number, o: { center: LngLat; zoom: number; pitch?: number; bearing?: number; offset?: [number, number] }, ms: number) {
    return this.cam(g, (m) => m.flyTo({ center: o.center, zoom: o.zoom, pitch: o.pitch ?? 0, bearing: o.bearing ?? 0, offset: o.offset ?? [0, 0], duration: ms, curve: 1.25, easing: EASE, essential: true }), ms);
  }

  /** Encuadra bounds solo si el cambio supera la tolerancia (evita micro-movimientos que se ven como vibración). */
  private async fit(g: number, b: [LngLat, LngLat], o: { maxZoom: number; pitch?: number; padding?: typeof PAD }, ms: number): Promise<boolean> {
    if (g !== this.gen) return false;
    const m = this.map;
    const c = m.cameraForBounds(b as LngLatBoundsLike, { padding: o.padding ?? PAD, maxZoom: o.maxZoom });
    if (!c?.center || c.zoom == null) return true;
    const ctr = maplibregl.LngLat.convert(c.center as any);
    const p = m.project(ctr), w = m.getCanvas().clientWidth, h = m.getCanvas().clientHeight;
    const dPx = Math.hypot(p.x - w / 2, p.y - h / 2);
    if (dPx < w * 0.06 && Math.abs(c.zoom - m.getZoom()) < 0.3 && Math.abs((o.pitch ?? 0) - m.getPitch()) < 6) return true;
    return this.fly(g, { center: [ctr.lng, ctr.lat], zoom: c.zoom, pitch: o.pitch ?? 0 }, ms);
  }

  private setMode(m: Mode) { if (this.mode !== m) { this.mode = m; this.cb.onMode?.(m); } }

  // ------------------------------------------------------------------ secuencia por consulta
  private routeFor(c: ConsultaPublica): Ruta {
    const pos: LngLat = [c.lon, c.lat];
    const o = c.resultado.origen;
    const lines = this.ruta.filter((f) => f.geometry.type === "LineString" && f.properties.cve_mun === c.cve_mun);
    const f = (o && lines.find((l) => l.properties.sistema === o.sistema)) || lines.find((l) => l.properties.sistema === "Cutzamala") || lines[0];
    const nodoEn = (p: LngLat) => this.ruta.find((x) => x.geometry.type === "Point" && Math.abs(x.geometry.coordinates[0] - p[0]) < 1e-3 && Math.abs(x.geometry.coordinates[1] - p[1]) < 1e-3)?.properties.id;
    if (f) {
      const coords = (f.geometry.coordinates as LngLat[]).slice(0, -1).concat([pos]); // termina en el PUNTO EXACTO de la consulta
      const origId = nodoEn(coords[0]);
      const nodos = coords.slice(1, -1).map((p) => ({ id: nodoEn(p) ?? "", pos: p })).filter((n) => n.id);
      return { orig: coords[0], nombre: o?.nombre ?? NODOS[origId ?? ""] ?? "Origen", sistema: f.properties.sistema ?? "", local: false, path: densify(coords), nodos };
    }
    const lab = this.alcLabel.get(c.cve_mun) ?? pos;
    return { orig: lab, nombre: o?.nombre ?? "Pozos locales", sistema: "pozos locales", local: true, path: densify([lab, pos], 30), nodos: [] };
  }

  private async runConsulta(p: Pt, otros: Pt[], g: number) {
    const multi = otros.length > 0;
    this.setMode(multi ? "multi" : "single");
    const ruta = this.routeFor(p.c);
    this.clearRoute();
    const lejos = !ruta.local && Math.hypot(ruta.orig[0] - p.pos[0], ruta.orig[1] - p.pos[1]) > 0.15;

    if (lejos) {
      // 1) zoom out: se ve de dónde viene el agua y a dónde llega
      if (!(await this.fit(g, bboxOf([ruta.orig, p.pos], 0.05), { maxZoom: 8.3, pitch: 0 }, this.map.getZoom() < 5 ? 2600 : 2000))) return;
      // 2) zoom in al origen, iluminado con su nombre
      this.showOrigin(ruta);
      if (!(await this.fly(g, { center: ruta.orig, zoom: 11.2, pitch: 45, bearing: -12 }, 2000))) return;
      if (!(await this.wait(1300, g))) return;
      // 3) zoom out con la ruta + 4) la línea de agua avanza hasta el punto exacto
      this.startTrip(ruta, p.nivel);
      if (!(await this.fit(g, bboxOf(ruta.path, 0.03), { maxZoom: 10.5, pitch: 20 }, 1900))) return;
      if (!(await this.wait(Math.max(0, TRIP_DRAW - (performance.now() - this.tripT0)) + 250, g))) return;
    } else {
      // Pozos locales / origen cercano: la secuencia se acorta (no hay presa que mostrar)
      this.showOrigin(ruta);
      if (!(await this.fit(g, bboxOf([ruta.orig, p.pos], 0.02), { maxZoom: 12.2, pitch: 30 }, 2000))) return;
      this.startTrip(ruta, p.nivel);
      if (!(await this.wait(TRIP_DRAW * 0.6, g))) return;
    }

    // 5) zoom a la colonia/punto con el contorno de la alcaldía en su semáforo
    const recientes = multi ? this.points.filter((x) => Date.now() - x.t <= MULTI_POINTS_WINDOW).slice(-10) : [p];
    if (multi && !recientes.includes(p)) recientes.push(p);
    this.lightAlcaldias(recientes.map((x) => x.c));
    this.focus = p;
    this.focusT = performance.now();
    if (multi) {
      if (!(await this.fit(g, bboxOf(recientes.map((x) => x.pos), 0.008), { maxZoom: 13, pitch: 35 }, 2000))) return;
      this.cb.onMulti?.(recientes.map((x) => x.c).reverse(), p.c);
    } else {
      if (!(await this.fly(g, { center: p.pos, zoom: 14, pitch: 50, bearing: 0, offset: OFFSET }, 2200))) return;
      this.cb.onPanel?.(p.c);
    }
    // 6) panel → toast
    if (!(await this.wait(900, g))) return;
    this.cb.onToast?.(p.c);
    await this.wait(DWELL, g);
  }

  private async runCaso(c: CasoAtencion, g: number) {
    this.setMode("caso");
    this.casoFoco = c.id;
    this.cb.onCasoFoco?.(c);
    if (!(await this.fly(g, { center: [c.lon, c.lat], zoom: 14.2, pitch: 40, bearing: 0, offset: OFFSET }, 2200))) return;
    await this.wait(4500, g);
  }

  private async goIdle() {
    if (this.runningGen === this.gen || this.jobs.length || this.pending.length) return;
    const g = this.gen;
    this.setMode("idle");
    this.clearRoute();
    this.focus = null;
    if (await this.fly(g, { center: IDLE.center, zoom: IDLE.zoom }, 3200)) { this.swayT0 = performance.now(); this.rotating = true; }
  }

  /** Atajo I: reposo ya (no borra puntos ni paneles). */
  idleNow() { clearTimeout(this.idleT); this.gen++; this.jobs = []; this.map?.stop(); void this.goIdle(); }

  /** R / Detener: OS limpio sin recargar (cola, timers, capas, puntos, cámara al globo). Realtime sigue vivo. */
  reset() {
    this.gen++;
    const g = this.gen;
    clearTimeout(this.coalesceT); this.coalesceT = null;
    clearTimeout(this.idleT);
    this.pending = []; this.jobs = [];
    this.map?.stop();
    this.points = []; this.reps = []; this.dataV++;
    this.clearRoute();
    this.focus = null; this.casoFoco = null;
    this.lightAlcaldias([]);
    this.casos = [];
    void this.paintCasos();
    this.setMode("idle");
    this.cb.onReset?.();
    if (this.map) void this.fly(g, { center: IDLE.center, zoom: IDLE.zoom }, 1800).then((ok) => { if (ok) { this.swayT0 = performance.now(); this.rotating = true; } });
  }

  // ------------------------------------------------------------------ alcaldías
  private lightAlcaldias(cs: ConsultaPublica[]) {
    const want = new Map<string, Nivel>();
    for (const c of cs) { const prev = want.get(c.cve_mun); if (!prev || RANK[c.nivel] > RANK[prev]) want.set(c.cve_mun, c.nivel); }
    for (const [cve, s] of this.alc) if (!want.has(cve)) s.target = 0;
    for (const [cve, nivel] of want) {
      const s = this.alc.get(cve);
      if (s) { s.target = 1; s.nivel = nivel; } else this.alc.set(cve, { nivel, k: 0, target: 1 });
      this.map?.setFeatureState({ source: "alcaldias", id: cve }, { nivel });
    }
  }
  private stepAlcaldias(dt: number) {
    if (!this.map?.getSource("alcaldias")) return;
    for (const [cve, s] of this.alc) {
      if (s.k === s.target) continue;
      s.k = s.target > s.k ? Math.min(1, s.k + dt / 600) : Math.max(0, s.k - dt / 600);
      this.map.setFeatureState({ source: "alcaldias", id: cve }, { k: s.k, nivel: s.nivel });
      if (s.k === 0 && s.target === 0) this.alc.delete(cve);
    }
  }

  // ------------------------------------------------------------------ ruta / origen
  private clearRoute() {
    for (const mk of this.markers) mk.remove();
    this.markers = [];
    this.route = null;
    this.trips = [];
  }
  private showOrigin(r: Ruta) {
    this.route = r;
    const el = document.createElement("div");
    el.className = "os-origin";
    el.innerHTML = `<div class="k">Viene de</div><div class="n"></div><div class="s"></div>`;
    (el.querySelector(".n") as HTMLElement).textContent = r.nombre;
    (el.querySelector(".s") as HTMLElement).textContent = `${r.local ? "Sistema local" : `Sistema ${r.sistema}`} · ruta aproximada`;
    this.markers.push(new maplibregl.Marker({ element: el, anchor: "left", offset: [22, 0] }).setLngLat(r.orig).addTo(this.map));
  }
  private startTrip(r: Ruta, nivel: Nivel) {
    const n = r.path.length - 1;
    const to = RGBN[nivel];
    this.trips = [{
      path: r.path, nivel,
      timestamps: r.path.map((_, i) => (i / n) * TRIP_DUR),
      colors: r.path.map((_, i) => { const t = i / n; return [lerp(CIAN[0], to[0], t), lerp(CIAN[1], to[1], t), lerp(CIAN[2], to[2], t), 255]; }),
    }];
    this.tripT0 = performance.now();
    for (const nd of r.nodos) {
      const el = document.createElement("div");
      el.className = "os-node";
      el.textContent = NODOS[nd.id] ?? nd.id;
      this.markers.push(new maplibregl.Marker({ element: el, anchor: "left", offset: [8, 0] }).setLngLat(nd.pos).addTo(this.map));
    }
  }

  // ------------------------------------------------------------------ deck.gl (carga diferida)
  private ensureDeck() {
    if (this.deck || this.deckLoading) return;
    this.deckLoading = (async () => {
      const [{ MapboxOverlay }, layers, geo] = await Promise.all([import("@deck.gl/mapbox"), import("@deck.gl/layers"), import("@deck.gl/geo-layers")]);
      if (this.destroyed) return;
      this.deck = { ScatterplotLayer: layers.ScatterplotLayer, PathLayer: layers.PathLayer, TripsLayer: geo.TripsLayer };
      this.whenReady(() => {
        this.overlay = new MapboxOverlay({ interleaved: !(window as any).__sedDeckOverlaid, layers: [], useDevicePixels: Math.min(window.devicePixelRatio || 1, 2) } as any);
        this.map.addControl(this.overlay);
      });
    })();
  }

  private memo = { v: -1, bucket: -1, pts: [] as Pt[], reps: [] as Rep[] };

  private buildLayers(now: number) {
    const D = this.deck;
    const tNow = Date.now();
    const bucket = Math.floor(tNow / 10_000);
    if (this.memo.v !== this.dataV || this.memo.bucket !== bucket) { this.memo = { v: this.dataV, bucket, pts: this.points.slice(), reps: this.reps.slice() }; }
    const { pts, reps } = this.memo;
    const ageAlpha = (t: number) => Math.round(255 * Math.max(0.35, 1 - (tNow - t) / AGE_FADE));
    const P = { depthCompare: "always" } as const;
    const out: any[] = [];

    if (this.trips.length) {
      const el = now - this.tripT0;
      if (el < TRIP_DRAW) {
        out.push(new D.TripsLayer({ id: "ruta-draw", data: this.trips, getPath: (d: Trip) => d.path, getTimestamps: (d: Trip) => d.timestamps, getColor: (d: Trip) => d.colors,
          widthUnits: "pixels", getWidth: 5, capRounded: true, jointRounded: true, fadeTrail: false, trailLength: TRIP_DUR * 2, currentTime: (el / TRIP_DRAW) * TRIP_DUR, parameters: P }));
      } else {
        out.push(new D.PathLayer({ id: "ruta-base", data: this.trips, getPath: (d: Trip) => d.path, getColor: (d: Trip) => d.colors.map((c) => [c[0], c[1], c[2], 150]),
          widthUnits: "pixels", getWidth: 3, capRounded: true, jointRounded: true, parameters: P }));
        out.push(new D.TripsLayer({ id: "ruta-flow", data: this.trips, getPath: (d: Trip) => d.path, getTimestamps: (d: Trip) => d.timestamps, getColor: (d: Trip) => d.colors,
          widthUnits: "pixels", getWidth: 6, capRounded: true, jointRounded: true, fadeTrail: true, trailLength: TRIP_TRAIL, currentTime: ((el - TRIP_DRAW) % TRIP_CYCLE), parameters: P }));
      }
    }
    if (this.route) {
      const ph = (now % 1800) / 1800;
      out.push(new D.ScatterplotLayer({ id: "origen-halo", data: [this.route.orig], getPosition: (d: LngLat) => d, radiusUnits: "pixels", getRadius: 14, radiusScale: 1 + ph * 2.4,
        filled: true, getFillColor: [...CIAN, Math.round(70 * (1 - ph))], stroked: true, getLineColor: [...CIAN, Math.round(230 * (1 - ph))], lineWidthUnits: "pixels", getLineWidth: 2, parameters: P }));
      out.push(new D.ScatterplotLayer({ id: "origen", data: [this.route.orig], getPosition: (d: LngLat) => d, radiusUnits: "pixels", getRadius: 8,
        getFillColor: [...CIAN, 255], stroked: true, getLineColor: [255, 255, 255, 255], lineWidthUnits: "pixels", getLineWidth: 2, parameters: P }));
    }
    // reportes de vecinos (anillo por tipo)
    if (reps.length) out.push(new D.ScatterplotLayer({ id: "reps", data: reps, getPosition: (d: Rep) => d.pos, radiusUnits: "pixels", getRadius: 5,
      getFillColor: [10, 14, 22, 220], stroked: true, getLineColor: (d: Rep) => [...d.rgb, ageAlpha(Date.parse(d.r.created_at))], lineWidthUnits: "pixels", getLineWidth: 2.2,
      updateTriggers: { getLineColor: bucket }, parameters: P }));
    out.push(new D.ScatterplotLayer({ id: "pts", data: pts, getPosition: (p: Pt) => p.pos, radiusUnits: "pixels", getRadius: 6,
      getFillColor: (p: Pt) => [...RGBN[p.nivel], ageAlpha(p.t)], stroked: true, getLineColor: (p: Pt) => [255, 255, 255, Math.round(ageAlpha(p.t) * 0.7)],
      lineWidthUnits: "pixels", getLineWidth: 1.2, updateTriggers: { getFillColor: bucket, getLineColor: bucket }, parameters: P }));
    // pulsos cortos: consultas y reportes recién llegados
    const pnow = performance.now();
    const fresh = [
      ...pts.filter((p) => pnow - p.arr < PULSE_MS && p !== this.focus).map((p) => ({ pos: p.pos, rgb: RGBN[p.nivel], a: p.arr })),
      ...reps.filter((r) => pnow - r.arr < PULSE_MS).map((r) => ({ pos: r.pos, rgb: r.rgb, a: r.arr })),
    ];
    if (fresh.length) {
      const ph = ((now % 1300) / 1300);
      out.push(new D.ScatterplotLayer({ id: "pulse", data: fresh, getPosition: (d: any) => d.pos, radiusUnits: "pixels", getRadius: 8, radiusScale: 1 + ph * 3,
        filled: false, stroked: true, getLineColor: (d: any) => [...d.rgb, 255], lineWidthUnits: "pixels", getLineWidth: 2, opacity: (1 - ph) * 0.9, parameters: P }));
    }
    if (this.focus) {
      const k = Math.min(1, (now - this.focusT) / 500);
      const ph = (now % 1600) / 1600;
      out.push(new D.ScatterplotLayer({ id: "focus", data: [this.focus], getPosition: (p: Pt) => p.pos, radiusUnits: "pixels", getRadius: 14, radiusScale: k * (1 + ph * 1.8),
        filled: false, stroked: true, getLineColor: [...RGBN[this.focus.nivel], 230], opacity: 1 - ph * 0.8, lineWidthUnits: "pixels", getLineWidth: 2, parameters: P }));
    }
    return out;
  }

  // ------------------------------------------------------------------ bucle único de animación
  private loop = (now: number) => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = this.lastFrame ? Math.min(64, now - this.lastFrame) : 16;
    this.lastFrame = now;
    const m = this.map;
    if (!m) return;
    if (this.mode === "idle" && this.rotating && !m.isMoving() && this.runningGen === -1) {
      if (!this.swayT0) this.swayT0 = now;
      const k = Math.sin(((now - this.swayT0) / SWAY_PERIOD) * Math.PI * 2);
      m.jumpTo({ center: [IDLE.center[0] + SWAY_DEG * k, IDLE.center[1]], bearing: 0, pitch: 0 });
    }
    this.stepAlcaldias(dt);
    // pulso del contorno de las zonas en alerta (~20 fps, una sola propiedad de pintura)
    if (this.casos.length && now - this.lastCasoPaint > 50 && m.getLayer("caso-glow")) {
      this.lastCasoPaint = now;
      const ph = (Math.sin((now / 900) * Math.PI) + 1) / 2;
      m.setPaintProperty("caso-glow", "line-opacity", 0.35 + 0.55 * ph);
      m.setPaintProperty("caso-fill", "fill-opacity", 0.08 + 0.12 * ph);
    }
    if (this.overlay && this.deck) {
      const pnow = performance.now();
      const animating = this.trips.length > 0 || !!this.route || !!this.focus || this.points.some((p) => pnow - p.arr < PULSE_MS) || this.reps.some((r) => pnow - r.arr < PULSE_MS);
      if (animating || this.memo.v !== this.dataV || this.memo.bucket !== Math.floor(Date.now() / 10_000)) this.overlay.setProps({ layers: this.buildLayers(now) });
    }
  };

  destroy() {
    this.destroyed = true;
    this.gen++;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.coalesceT); clearTimeout(this.idleT);
    for (const mk of this.markers) mk.remove();
    try { this.map?.remove(); } catch {}
  }

  get modeNow() { return this.mode; }
  /** Diagnóstico para verificar estabilidad (consola: __sedEngine.stats()). */
  stats() { return { mode: this.mode, jobs: this.jobs.length, pending: this.pending.length, running: this.runningGen === this.gen, camMoves: this.camMoves, points: this.points.length, reps: this.reps.length, casos: this.casos.length, gen: this.gen }; }
}

/** Círculo aproximado (km) para zonas sin colonia de catálogo. */
function circle(c: LngLat, km: number) {
  const pts: LngLat[] = [];
  for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; pts.push([c[0] + (km / (111.32 * Math.cos((c[1] * Math.PI) / 180))) * Math.cos(a), c[1] + (km / 110.57) * Math.sin(a)]); }
  return { type: "Polygon", coordinates: [pts] };
}
