// Motor del OS: MapLibre (globo) + deck.gl interleaved + cola de animaciones.
// Todo el estado de animación vive aquí (fuera de React). React solo recibe callbacks cuando cambia algo visible del HUD/panel.
import maplibregl, { type Map as MLMap, type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import type { ConsultaPublica, Nivel } from "@/lib/types";

export type Mode = "idle" | "single" | "multi";
type RGB = [number, number, number];
type LngLat = [number, number];

export const HEX: Record<Nivel, string> = { verde: "#22c55e", ambar: "#f59e0b", rojo: "#ef4444", gris: "#64748b" };
const RGBN: Record<Nivel, RGB> = { verde: [34, 197, 94], ambar: [245, 158, 11], rojo: [239, 68, 68], gris: [100, 116, 139] };
const CIAN: RGB = [56, 189, 248];

const CDMX: LngLat = [-99.13, 19.4];
const IDLE = { center: [-101.2, 21.8] as LngLat, zoom: 2.35, pitch: 0, bearing: 0 };
const POINT_TTL = 10 * 60_000;
const MULTI_WINDOW = 10_000;
const MULTI_POINTS_WINDOW = 120_000;
const QUIET_TO_SINGLE = 10_000;
const IDLE_AFTER = 60_000;
// Reposo: norte arriba y México al centro; vaivén suave en longitud (±SWAY_DEG) que siempre regresa al centro.
const SWAY_DEG = 6;
const SWAY_PERIOD = 48_000;
const DEBOUNCE = 400;
const QUEUE_MAX = 20;
const TRIP_DUR = 2500;
const TRIP_TRAIL = 1600;
const TRIP_CYCLE = TRIP_DUR + TRIP_TRAIL + 400;
const PANEL_W = 540;
const FOCUS_PAD = { top: 80, bottom: 0, left: 0, right: PANEL_W };

const NODOS: Record<string, string> = {
  presa_valle_de_bravo: "Presa Valle de Bravo",
  presa_villa_victoria: "Presa Villa Victoria",
  presa_el_bosque: "Presa El Bosque",
  planta_los_berros: "Planta Los Berros",
  entrada_poniente_cdmx: "Entrada poniente",
  norte_chalmita: "Tanques Chalmita",
  oriente_la_caldera: "Acueducto La Caldera",
};

interface Pt { c: ConsultaPublica; t: number; pos: LngLat; nivel: Nivel }
interface Trip { key: string; cve_mun: string; sistema: string; orig: LngLat[]; path: LngLat[]; timestamps: number[]; colors: number[][]; nivel: Nivel }
interface RutaFeature { type: "Feature"; geometry: { type: "LineString" | "Point"; coordinates: any }; properties: { id?: string; tipo?: string; cve_mun?: string; sistema?: string } }

export interface EngineCallbacks {
  onMode?: (m: Mode) => void;
  onPanel?: (c: ConsultaPublica) => void; // panel de detalle (single)
  onToast?: (c: ConsultaPublica) => void; // texto WhatsApp enviado
  onMulti?: (list: ConsultaPublica[]) => void; // lista compacta (multi)
  onPoints?: (n: number) => void;
}

export interface EngineInit {
  container: HTMLElement;
  styleUrl: string;
  satTiles?: string;
  cb: EngineCallbacks;
  onReady?: (info: { offline: boolean }) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

async function loadStyle(url: string): Promise<{ style: StyleSpecification | string; offline: boolean }> {
  const offline: StyleSpecification = {
    version: 8,
    sources: {
      land: { type: "geojson", data: "/offline/land-110m.geojson" },
      borders: { type: "geojson", data: "/offline/borders-110m.geojson" },
    },
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
    const s = (await r.json()) as StyleSpecification;
    return { style: s, offline: false };
  } catch (e) {
    console.warn("[os] estilo remoto no disponible, uso estilo offline:", (e as Error).message);
    return { style: offline, offline: true };
  }
}

/** Densifica una línea (interpolación lineal) para gradiente suave y curvatura en el globo. */
function densify(coords: LngLat[], n = 72): LngLat[] {
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

function bboxOf(pts: LngLat[]): [LngLat, LngLat] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [[x0, y0], [x1, y1]];
}

export class OsEngine {
  map!: MLMap;
  private cb: EngineCallbacks;
  private overlay: any = null;
  private deck: any = null; // módulos deck.gl (carga diferida)
  private deckLoading: Promise<void> | null = null;
  private mode: Mode = "idle";
  private points: Pt[] = [];
  private seen = new Set<string>();
  private queue: ConsultaPublica[] = [];
  private arrivals: number[] = [];
  private debounceT: any; private quietT: any; private idleT: any;
  private camChain: Promise<void> = Promise.resolve();
  private gen = 0;
  private rotating = true;
  private swayT0 = 0;
  private alc = new Map<string, { nivel: Nivel; k: number; target: number }>();
  private trips: Trip[] = [];
  private tripsOrigin = 0;
  private focus: Pt | null = null;
  private focusT = 0;
  private ruta: RutaFeature[] = [];
  private markers: maplibregl.Marker[] = [];
  private raf = 0;
  private lastFrame = 0;
  private pointsVersion = 0;
  private ageBucket = 0;
  private destroyed = false;
  ready = false;

  constructor(private init: EngineInit) {
    this.cb = init.cb;
  }

  async start() {
    // GeoJSON en paralelo con el estilo; el OS queda "listo" en cuanto hay estilo + capas propias (sin esperar todos los tiles).
    const geoP = Promise.all([
      fetch("/api/brain/geo?f=alcaldias").then((r) => r.json()),
      fetch("/api/brain/geo?f=ruta").then((r) => r.json()),
    ]);
    const { style, offline } = await loadStyle(this.init.styleUrl);
    if (this.destroyed) return;
    const map = new maplibregl.Map({
      container: this.init.container,
      style,
      center: IDLE.center,
      zoom: IDLE.zoom,
      pitch: 0,
      maxPitch: 70,
      attributionControl: { compact: true },
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      fadeDuration: 0,
      canvasContextAttributes: { antialias: true },
    } as any);
    this.map = map;
    let styled = false;
    const styleP = new Promise<void>((res) => {
      const done = () => { if (!styled) { styled = true; this.onStyle(offline); res(); } };
      map.once("style.load", done);
      map.once("load", done); // respaldo
      if (map.isStyleLoaded()) done();
    });
    this.loop(performance.now());
    const [[alcGeo, rutaGeo]] = await Promise.all([geoP, styleP]);
    if (this.destroyed) return;
    this.ruta = rutaGeo.features;
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
      "sky-color": "#05070b",
      "horizon-color": "#0c2a4a",
      "fog-color": "#05070b",
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.4,
      "fog-ground-blend": 0.85,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 6, 0.6, 9, 0],
    } as any);
    if (!offline) {
      // atenúa el basemap para que el semáforo resalte
      for (const l of m.getStyle().layers ?? []) {
        if (l.type === "background") m.setPaintProperty(l.id, "background-color", "#05070b");
      }
    }
    if (this.init.satTiles) {
      m.addSource("sat", { type: "raster", tiles: [this.init.satTiles], tileSize: 256, attribution: "Imagen satelital: ver NEXT_PUBLIC_SAT_TILES" });
      m.addLayer({ id: "sat", type: "raster", source: "sat", layout: { visibility: "none" }, paint: { "raster-opacity": 0.85, "raster-saturation": -0.3, "raster-brightness-max": 0.75 } }, this.firstSymbol());
    }
  }

  private firstSymbol() {
    return this.map.getStyle().layers?.find((l) => l.type === "symbol")?.id;
  }

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
  }

  setSat(on: boolean) {
    if (this.map?.getLayer("sat")) this.map.setLayoutProperty("sat", "visibility", on ? "visible" : "none");
  }

  // ------------------------------------------------------------------ entrada de eventos
  /** Devuelve false si es duplicado o demasiado viejo. */
  push(c: ConsultaPublica, opt: { animate?: boolean } = {}): boolean {
    if (this.seen.has(c.id)) return false;
    this.seen.add(c.id);
    const t = Date.parse(c.created_at) || Date.now();
    const age = Date.now() - t;
    if (age > POINT_TTL) return false;
    const pt: Pt = { c, t: Math.min(t, Date.now()), pos: [c.lon, c.lat], nivel: c.nivel };
    this.points.push(pt);
    this.pointsVersion++;
    this.cb.onPoints?.(this.points.length);
    this.ensureDeck();
    if (opt.animate === false) return true;
    this.arrivals.push(Date.now());
    this.queue.push(c);
    if (this.queue.length > QUEUE_MAX) this.queue.splice(0, this.queue.length - QUEUE_MAX); // descarta animaciones viejas; el punto ya se pintó
    clearTimeout(this.debounceT);
    this.debounceT = setTimeout(() => this.process(), DEBOUNCE);
    return true;
  }

  private process() {
    if (!this.ready) { this.whenReady(() => this.process()); return; }
    const batch = this.queue.splice(0);
    this.dbg("process batch", batch.length, "arrivals", this.arrivals.length);
    if (!batch.length) return;
    const now = Date.now();
    this.arrivals = this.arrivals.filter((t) => now - t <= MULTI_WINDOW);
    const g = ++this.gen;
    clearTimeout(this.quietT);
    clearTimeout(this.idleT);
    this.idleT = setTimeout(() => this.goIdle(), IDLE_AFTER);
    // ≥2 en la ventana de 10 s, o ≥2 en el mismo lote (p. ej. ráfaga que esperó a que cargara el mapa) → multi-punto
    if (this.arrivals.length >= 2 || batch.length >= 2) void this.runMulti(g);
    else void this.runSingle(this.ptOf(batch[batch.length - 1]), g);
  }

  private ptOf(c: ConsultaPublica) {
    return this.points.find((p) => p.c.id === c.id) ?? { c, t: Date.now(), pos: [c.lon, c.lat] as LngLat, nivel: c.nivel };
  }

  // ------------------------------------------------------------------ cámara (máx 1 activa)
  private camera(op: (m: MLMap) => void, ms: number, onStart?: () => void): Promise<void> {
    const run = () =>
      new Promise<void>((res) => {
        if (this.destroyed) return res();
        let done = false;
        const fin = () => { if (!done) { done = true; res(); } };
        const go = () => {
          this.rotating = false;
          this.map.once("moveend", fin);
          onStart?.();
          op(this.map);
          setTimeout(fin, ms + 900);
        };
        if (this.map.isMoving()) this.map.once("moveend", go); else go();
      });
    this.camChain = this.camChain.then(run, run);
    return this.camChain;
  }

  private later(ms: number, g: number, fn: () => void) {
    setTimeout(() => { if (g === this.gen && !this.destroyed) fn(); }, ms);
  }

  private dbg(...a: unknown[]) { if ((window as any).__sedDebug) console.log("[os]", Math.round(performance.now()), ...a); }

  private setMode(m: Mode) {
    this.dbg("mode", this.mode, "→", m, "gen", this.gen);
    if (this.mode !== m) { this.mode = m; this.cb.onMode?.(m); }
  }

  private async runSingle(p: Pt, g: number) {
    const m = this.map;
    if (!m) return;
    this.setMode("single");
    if (m.getZoom() < 6) {
      await this.camera((mm) => mm.flyTo({ center: CDMX, zoom: 9, pitch: 40, bearing: 0, duration: 1800, essential: true, padding: FOCUS_PAD }), 1800);
      if (g !== this.gen) return;
    }
    const bearing = rand(-20, 20);
    const flight = this.camera(
      (mm) => mm.flyTo({ center: p.pos, zoom: 13.5, pitch: 55, bearing, duration: 2200, curve: 1.6, essential: true, padding: FOCUS_PAD }),
      2200,
      () => {
        this.dbg("flight start", p.c.colonia);
        this.focus = p; this.focusT = performance.now();
        this.later(800, g, () => this.lightAlcaldias([p.c]));
        this.later(1400, g, () => this.setTrips([p.c]));
        this.later(1700, g, () => { this.dbg("panel", p.c.colonia); this.cb.onPanel?.(p.c); });
        this.later(4300, g, () => this.cb.onToast?.(p.c));
      },
    );
    await flight;
    if (g !== this.gen) return;
    const cut = this.ruta.find((f) => f.geometry.type === "LineString" && f.properties.cve_mun === p.c.cve_mun && f.properties.sistema === "Cutzamala");
    if (cut) {
      await sleep(700);
      if (g !== this.gen) return;
      const [sw, ne] = bboxOf([...(cut.geometry.coordinates as LngLat[]), p.pos]);
      await this.camera((mm) => mm.fitBounds([sw, ne], { padding: { top: 160, bottom: 220, left: 160, right: PANEL_W + 120 }, pitch: 30, bearing: 0, duration: 1500, essential: true }), 1500);
      if (g !== this.gen) return;
      await sleep(1600);
      if (g !== this.gen) return;
      await this.camera((mm) => mm.flyTo({ center: p.pos, zoom: 13.5, pitch: 55, bearing, duration: 1500, curve: 1.4, essential: true, padding: FOCUS_PAD }), 1500);
    }
    if (g === this.gen) this.armQuiet();
  }

  private async runMulti(g: number) {
    const m = this.map;
    if (!m) return;
    this.setMode("multi");
    const now = Date.now();
    const recent = this.points.filter((p) => now - p.t <= MULTI_POINTS_WINDOW).slice(-8);
    if (!recent.length) return;
    this.focus = recent[recent.length - 1];
    this.focusT = performance.now();
    this.lightAlcaldias(recent.map((p) => p.c));
    this.setTrips(recent.map((p) => p.c));
    this.cb.onMulti?.(recent.map((p) => p.c).reverse());
    this.cb.onToast?.(recent[recent.length - 1].c);
    const [sw, ne] = bboxOf(recent.map((p) => p.pos));
    const pad = 0.01;
    await this.camera(
      (mm) => mm.fitBounds([[sw[0] - pad, sw[1] - pad], [ne[0] + pad, ne[1] + pad]], { padding: { top: 120, bottom: 120, left: 120, right: PANEL_W + 120 }, maxZoom: 12, pitch: 35, bearing: 0, duration: 1500, essential: true }),
      1500,
    );
    if (g === this.gen) this.armQuiet();
  }

  private armQuiet() {
    clearTimeout(this.quietT);
    if (this.mode !== "multi") return;
    const g = this.gen;
    this.quietT = setTimeout(() => {
      if (g !== this.gen || this.mode !== "multi") return;
      const last = this.points[this.points.length - 1];
      if (last) void this.runSingle(last, ++this.gen);
    }, QUIET_TO_SINGLE);
  }

  private async goIdle() {
    const g = ++this.gen;
    clearTimeout(this.quietT);
    this.setMode("idle");
    this.lightAlcaldias([]);
    this.setTrips([]);
    this.focus = null;
    await this.camera((mm) => mm.flyTo({ ...IDLE, duration: 3200, essential: true, padding: { top: 0, bottom: 0, left: 0, right: 0 } }), 3200);
    if (g === this.gen) { this.swayT0 = performance.now(); this.rotating = true; }
  }

  /** Demo: dispara el regreso al globo ya. */
  idleNow() { clearTimeout(this.idleT); void this.goIdle(); }

  // ------------------------------------------------------------------ alcaldías
  private lightAlcaldias(cs: ConsultaPublica[]) {
    const want = new Map<string, Nivel>();
    const rank: Record<Nivel, number> = { gris: 0, verde: 1, ambar: 2, rojo: 3 };
    for (const c of cs) { const prev = want.get(c.cve_mun); if (!prev || rank[c.nivel] > rank[prev]) want.set(c.cve_mun, c.nivel); }
    for (const [cve, s] of this.alc) if (!want.has(cve)) s.target = 0;
    for (const [cve, nivel] of want) {
      const s = this.alc.get(cve);
      if (s) { s.target = 1; s.nivel = nivel; } else this.alc.set(cve, { nivel, k: 0, target: 1 });
      this.map.setFeatureState({ source: "alcaldias", id: cve }, { nivel });
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

  // ------------------------------------------------------------------ rutas
  private setTrips(cs: ConsultaPublica[]) {
    const out: Trip[] = [];
    const seen = new Set<string>();
    for (const c of cs) {
      for (const f of this.ruta) {
        if (f.geometry.type !== "LineString" || f.properties.cve_mun !== c.cve_mun) continue;
        const key = `${c.cve_mun}-${f.properties.sistema}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const path = densify(f.geometry.coordinates as LngLat[]);
        const n = path.length - 1;
        const to = RGBN[c.nivel];
        out.push({
          key, cve_mun: c.cve_mun, sistema: f.properties.sistema ?? "", orig: f.geometry.coordinates as LngLat[], path, nivel: c.nivel,
          timestamps: path.map((_, i) => (i / n) * TRIP_DUR),
          colors: path.map((_, i) => { const t = i / n; return [lerp(CIAN[0], to[0], t), lerp(CIAN[1], to[1], t), lerp(CIAN[2], to[2], t), 255]; }),
        });
      }
    }
    this.trips = out;
    this.tripsOrigin = performance.now();
    this.updateMarkers();
  }

  private updateMarkers() {
    for (const mk of this.markers) mk.remove();
    this.markers = [];
    if (!this.trips.length) return;
    const ids = new Set<string>();
    for (const t of this.trips) for (const f of this.ruta) {
      if (f.geometry.type !== "Point") continue;
      const [x, y] = f.geometry.coordinates as LngLat;
      if (t.orig.some(([px, py]) => Math.abs(px - x) < 1e-3 && Math.abs(py - y) < 1e-3)) ids.add(f.properties.id!);
      if (t.sistema === "Cutzamala" && f.properties.id?.startsWith("presa_")) ids.add(f.properties.id);
    }
    for (const f of this.ruta) {
      if (f.geometry.type !== "Point" || !ids.has(f.properties.id!)) continue;
      const el = document.createElement("div");
      el.className = "os-node";
      el.innerHTML = `<span class="os-node-dot"></span><span>${NODOS[f.properties.id!] ?? f.properties.id}</span>`;
      this.markers.push(new maplibregl.Marker({ element: el, anchor: "left" }).setLngLat(f.geometry.coordinates).addTo(this.map));
    }
    const longest = [...this.trips].sort((a, b) => b.path.length - a.path.length || (a.sistema === "Cutzamala" ? -1 : 1))[0];
    const mid = longest.path[Math.floor(longest.path.length * 0.62)];
    const tag = document.createElement("div");
    tag.className = "os-route-tag";
    tag.textContent = "ruta aproximada · ilustrativa";
    this.markers.push(new maplibregl.Marker({ element: tag, anchor: "bottom", offset: [0, -8] }).setLngLat(mid).addTo(this.map));
  }

  // ------------------------------------------------------------------ deck.gl (carga diferida al primer evento)
  private ensureDeck() {
    if (this.deck || this.deckLoading) return;
    this.deckLoading = (async () => {
      const [{ MapboxOverlay }, layers, geo] = await Promise.all([import("@deck.gl/mapbox"), import("@deck.gl/layers"), import("@deck.gl/geo-layers")]);
      if (this.destroyed) return;
      this.deck = { ScatterplotLayer: layers.ScatterplotLayer, PathLayer: layers.PathLayer, TripsLayer: geo.TripsLayer };
      const attach = () => {
        this.overlay = new MapboxOverlay({ interleaved: !(window as any).__sedDeckOverlaid, layers: [], useDevicePixels: Math.min(window.devicePixelRatio || 1, 2) } as any);
        this.map.addControl(this.overlay);
      };
      this.whenReady(attach);
    })();
  }

  private memo: { v: number; bucket: number; trips: Trip[] | null; pts: Pt[]; nodes: any[] } = { v: -1, bucket: -1, trips: null, pts: [], nodes: [] };

  private buildLayers(now: number) {
    const D = this.deck;
    const tNow = Date.now();
    if (this.memo.v !== this.pointsVersion || this.memo.bucket !== this.ageBucket) {
      this.points = this.points.filter((p) => tNow - p.t <= POINT_TTL);
      this.memo.pts = this.points.slice();
      this.memo.v = this.pointsVersion;
      this.memo.bucket = this.ageBucket;
    }
    if (this.memo.trips !== this.trips) {
      this.memo.trips = this.trips;
      const ids = new Set(this.trips.flatMap((t) => t.orig.map((p) => p.join())));
      this.memo.nodes = this.ruta.filter((f) => f.geometry.type === "Point" && (ids.has((f.geometry.coordinates as LngLat).join()) || (f.properties.id?.startsWith("presa_") && this.trips.some((t) => t.sistema === "Cutzamala")))).map((f) => f.geometry.coordinates);
    }
    const pts = this.memo.pts;
    const ageAlpha = (p: Pt) => Math.round(255 * Math.max(0.25, 1 - (tNow - p.t) / POINT_TTL));
    const out: any[] = [];

    if (this.trips.length) {
      const ct = (now - this.tripsOrigin) % TRIP_CYCLE;
      out.push(new D.PathLayer({
        id: "ruta-base", data: this.trips, getPath: (d: Trip) => d.path, getColor: (d: Trip) => [...RGBN[d.nivel], 70],
        widthUnits: "pixels", getWidth: 2, capRounded: true, jointRounded: true, parameters: { depthCompare: "always" },
      }));
      out.push(new D.TripsLayer({
        id: "ruta-trips", data: this.trips, getPath: (d: Trip) => d.path, getTimestamps: (d: Trip) => d.timestamps, getColor: (d: Trip) => d.colors,
        widthUnits: "pixels", getWidth: 5, capRounded: true, jointRounded: true, fadeTrail: true, trailLength: TRIP_TRAIL, currentTime: ct,
        parameters: { depthCompare: "always" },
      }));
      out.push(new D.ScatterplotLayer({
        id: "ruta-nodos", data: this.memo.nodes, getPosition: (d: LngLat) => d, getRadius: 4, radiusUnits: "pixels",
        getFillColor: [...CIAN, 230], stroked: true, getLineColor: [5, 7, 11, 255], lineWidthUnits: "pixels", getLineWidth: 1.5,
        parameters: { depthCompare: "always" },
      }));
    }

    out.push(new D.ScatterplotLayer({
      id: "pts", data: pts, getPosition: (p: Pt) => p.pos, radiusUnits: "pixels", getRadius: 6,
      getFillColor: (p: Pt) => [...RGBN[p.nivel], ageAlpha(p)], stroked: true, getLineColor: (p: Pt) => [255, 255, 255, Math.round(ageAlpha(p) * 0.7)],
      lineWidthUnits: "pixels", getLineWidth: 1.2, updateTriggers: { getFillColor: this.ageBucket, getLineColor: this.ageBucket },
      transitions: { getRadius: { duration: 500 } }, parameters: { depthCompare: "always" },
    }));

    const fresh = pts.filter((p) => tNow - p.t < 9000 || p === this.focus);
    if (fresh.length) {
      const phase = ((now % 1600) / 1600);
      out.push(new D.ScatterplotLayer({
        id: "pulse", data: fresh, getPosition: (p: Pt) => p.pos, radiusUnits: "pixels", getRadius: 8, radiusScale: 1 + phase * 3.2,
        filled: false, stroked: true, getLineColor: (p: Pt) => [...RGBN[p.nivel], 255], lineWidthUnits: "pixels", getLineWidth: 2,
        opacity: (1 - phase) * 0.9, parameters: { depthCompare: "always" },
      }));
    }
    if (this.focus) {
      const k = Math.min(1, (now - this.focusT) / 500);
      out.push(new D.ScatterplotLayer({
        id: "focus", data: [this.focus], getPosition: (p: Pt) => p.pos, radiusUnits: "pixels", getRadius: 14, radiusScale: k,
        filled: false, stroked: true, getLineColor: [...CIAN, 220], lineWidthUnits: "pixels", getLineWidth: 1.5, parameters: { depthCompare: "always" },
      }));
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
    if (this.mode === "idle" && this.rotating && !m.isMoving()) {
      if (!this.swayT0) this.swayT0 = now;
      const k = Math.sin(((now - this.swayT0) / SWAY_PERIOD) * Math.PI * 2);
      m.jumpTo({ center: [IDLE.center[0] + SWAY_DEG * k, IDLE.center[1]], bearing: 0, pitch: 0 });
    }
    this.stepAlcaldias(dt);
    const bucket = Math.floor(Date.now() / 5000);
    if (bucket !== this.ageBucket) this.ageBucket = bucket;
    if (this.overlay && this.deck) {
      const animating = this.trips.length > 0 || this.points.some((p) => Date.now() - p.t < 9000) || !!this.focus;
      if (animating || this.memo.v !== this.pointsVersion || this.memo.bucket !== this.ageBucket) this.overlay.setProps({ layers: this.buildLayers(now) });
    }
  };

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.debounceT); clearTimeout(this.quietT); clearTimeout(this.idleT);
    for (const mk of this.markers) mk.remove();
    try { this.map?.remove(); } catch {}
  }

  get modeNow() { return this.mode; }
}
