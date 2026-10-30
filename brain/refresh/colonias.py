"""Colonias CDMX (Datos CDMX) simplificadas para point-in-polygon en servidor (no para render inicial)."""
import json, pathlib
from shapely.geometry import shape, mapping
from _common import save
RAW = pathlib.Path(__file__).parent.parent.parent / "raw" / "colonias.geojson"
def rnd(o): return [rnd(x) for x in o] if isinstance(o, (list, tuple)) and o and isinstance(o[0], (list, tuple)) else [round(o[0], 5), round(o[1], 5)]
fs = []
for f in json.load(open(RAW))["features"]:
    g = shape(f["geometry"]).simplify(0.00015, preserve_topology=True); m = mapping(g)
    p = f["properties"]
    fs.append({"type": "Feature", "geometry": {"type": m["type"], "coordinates": rnd(m["coordinates"])},
               "properties": {"cve_col": p["cve_col"], "colonia": p["colonia"], "cve_mun": p["cve_alc"], "alcaldia": p["alc"]}})
save("colonias.simplified.geojson", {"type": "FeatureCollection", "_meta": {"fuente": "Datos Abiertos CDMX – Colonias de la Ciudad de México", "url": "https://datos.cdmx.gob.mx/dataset/coloniascdmx",
     "fecha_corte": "estático", "frecuencia": "estático", "verificado": "descargado 30-oct-2026; simplificado 0.00015° (~15 m)"}, "features": fs})
