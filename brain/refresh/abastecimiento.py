"""Mapa alcaldía -> sistema de abastecimiento (curado de fuentes públicas) + rutas APROXIMADAS para la animación.
No hay dataset oficial descargable por alcaldía (Agua en tu colonia/SEGIAGUA no respondió; PDF SEDEMA dio 403). POR VALIDAR."""
import json, pathlib
from _common import save, ALC
D = pathlib.Path(__file__).parent.parent / "data"
F = {
 "mvs": {"t": "MVS Noticias – Estas son las alcaldías de CDMX que reciben agua del Cutzamala", "url": "https://mvsnoticias.com/nacional/2025/10/17/estas-son-las-alcaldias-de-cdmx-que-reciben-agua-del-cutzamala-708745.html", "fecha": "2025-10-17"},
 "milenio": {"t": "Milenio – Sistema Cutzamala: ¿qué alcaldías de CdMx abastece?", "url": "https://www.milenio.com/politica/comunidad/sistema-cutzamala-alcaldias-cdmx-abastece-agua", "fecha": "por validar"},
 "chalmita": {"t": "El Heraldo de México – megacorte por redistribución desde tanques Chalmita (GAM)", "url": "https://heraldodemexico.com.mx/nacional/2026/10/3/alertan-por-megacorte-de-agua-que-durara-hasta-el-de-octubre-lista-de-colonias-afectadas-900651.html", "fecha": "2026-10-03"},
 "caldera": {"t": "El Heraldo de México – Iztapalapa y Tláhuac 39 h sin agua (fuga acueducto La Caldera / ramal Mixquic-Tláhuac)", "url": "https://heraldodemexico.com.mx/nacional/2026/10/5/iztapalapa-tlahuac-no-tendran-agua-en-las-proximas-39-horas-lista-de-colonias-afectadas-901851.html", "fecha": "2026-10-05"},
}
CUTZ = ["010", "002", "014", "003", "004", "015", "006", "007", "008", "016", "012", "017"]
out = {}
for c, n in ALC.items():
    if c in CUTZ:
        out[c] = {"alcaldia": n, "cutzamala": True, "sistemas": ["Cutzamala", "pozos locales / otros (proporción por validar)"], "fuentes": ["mvs"]}
    else:
        out[c] = {"alcaldia": n, "cutzamala": False, "sistemas": ["pozos y manantiales locales"], "fuentes": ["mvs"]}
out["005"]["sistemas"] = ["pozos locales", "tanques Chalmita (redistribución)"]; out["005"]["fuentes"] += ["chalmita"]
out["007"]["sistemas"].insert(1, "acueducto La Caldera / ramal Mixquic-Tláhuac (oriente)"); out["007"]["fuentes"] += ["caldera"]
out["011"]["sistemas"] = ["pozos locales", "acueducto La Caldera / ramal Mixquic-Tláhuac"]; out["011"]["fuentes"] += ["caldera", "milenio"]
out["011"]["nota"] = "Milenio la incluye entre alcaldías con Cutzamala; MVS no. Tratar Cutzamala como 'parcial, por validar'."
save("abastecimiento_alcaldia.json", {"_meta": {"fuente": "Curado de prensa (ver 'fuentes'); validar contra SEGIAGUA 'Agua en tu colonia'", "url": F["mvs"]["url"],
     "fecha_corte": "2026-10-05", "frecuencia": "manual", "verificado": "POR VALIDAR – no es dataset oficial por alcaldía"}, "fuentes": F, "por_cve_mun": out})
# --- rutas aproximadas (solo visual) ---
cz = json.load(open(D / "cutzamala_latest.json"))["presas_coords_aprox"]
alc = {f["properties"]["cve_mun"]: f["properties"] for f in json.load(open(D / "alcaldias.simplified.geojson"))["features"]}
P = {"presa_valle_de_bravo": cz["valle_de_bravo"], "presa_villa_victoria": cz["villa_victoria"], "presa_el_bosque": cz["el_bosque"],
     "planta_los_berros": [19.4038, -100.070],            # localidad Los Berros, Villa de Allende (OSM) – planta aprox.
     "entrada_poniente_cdmx": [19.36, -99.30],            # ILUSTRATIVO: entrada poniente, no es infraestructura georreferenciada
     "norte_chalmita": [19.555, -99.14],                  # ILUSTRATIVO: zona Cuautepec/Chalmita
     "oriente_la_caldera": [19.33, -98.97]}               # ILUSTRATIVO: oriente (La Caldera)
ll = lambda p: [p[1], p[0]]
feats = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": ll(v)}, "properties": {"id": k, "tipo": "nodo", "aproximado": True}} for k, v in P.items()]
for c, a in alc.items():
    dst = [a["label_lon"], a["label_lat"]]; segs = []
    if out[c]["cutzamala"]:
        segs.append(("Cutzamala", [ll(P["presa_valle_de_bravo"]), ll(P["planta_los_berros"]), ll(P["entrada_poniente_cdmx"]), dst]))
    if c == "005": segs.append(("Chalmita", [ll(P["norte_chalmita"]), dst]))
    if c in ("007", "011"): segs.append(("La Caldera", [ll(P["oriente_la_caldera"]), dst]))
    for s, coords in segs:
        feats.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords},
                      "properties": {"cve_mun": c, "sistema": s, "aproximada": True, "etiqueta": "ruta aproximada"}})
save("ruta_agua.geojson", {"type": "FeatureCollection", "_meta": {"fuente": "Construcción propia para visualización; nodos aproximados (ver propiedades)",
     "url": None, "fecha_corte": "2026-10-30", "frecuencia": "manual", "verificado": "NO – ruta aproximada/ilustrativa"}, "features": feats})
