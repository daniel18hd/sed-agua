"""Polígonos de alcaldías CDMX simplificados (Datos CDMX, dataset 'alcaldias')."""
import json
from shapely.geometry import shape, mapping
from _common import fetch, save, DATA, ALC
URL = "https://datos.cdmx.gob.mx/dataset/bae265a8-d1f6-4614-b399-4184bc93e027/resource/deb5c583-84e2-4e07-a706-1b3a0dbc99b0/download/deb5c583-84e2-4e07-a706-1b3a0dbc99b0.json"
gj = json.loads(fetch(URL, "alcaldias.geojson").read_text())
feats = []
for f in gj["features"]:
    g = shape(f["geometry"]).simplify(0.0008, preserve_topology=True)
    g2 = round_geom = json.loads(json.dumps(mapping(g)), parse_float=lambda x: round(float(x), 5))
    c = g.representative_point()
    cve = f["properties"]["CVE_MUN"]
    b = g.bounds
    feats.append({"type": "Feature", "id": int(cve),
        "properties": {"cvegeo": f["properties"]["CVEGEO"], "cve_mun": cve, "nombre": f["properties"]["NOMGEO"],
                       "label_lat": round(c.y, 5), "label_lon": round(c.x, 5), "bbox": [round(x, 5) for x in b]},
        "geometry": g2})
out = {"type": "FeatureCollection", "features": feats,
       "_meta": {"fuente": "Datos Abiertos CDMX – Alcaldías", "url": URL, "fecha_corte": "estático (límites oficiales)",
                 "frecuencia": "estático", "verificado": "HTTP 200 30-oct-2026; simplificado tolerance 0.0008° (~80 m)"}}
(DATA / "alcaldias.simplified.geojson").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
save("alcaldias.meta.json", {"_meta": out["_meta"], "n": len(feats)})
