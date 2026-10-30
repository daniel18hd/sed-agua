"""Colonias con distribución de agua por tandeo 2019 (Datos CDMX) agregadas por alcaldía + lista de colonias."""
import zipfile, shapefile, collections
from _common import fetch, save, RAW, ALC
import unicodedata
norm=lambda x:"".join(c for c in unicodedata.normalize("NFD",x.upper()) if unicodedata.category(c)!="Mn")
N2C={norm(v):k for k,v in ALC.items()}
URL = "https://datos.cdmx.gob.mx/dataset/cba78780-cdf0-464c-a9c2-3078c0fdf7f1/resource/33808cea-fa25-45db-becd-43d380d65e3a/download/33808cea-fa25-45db-becd-43d380d65e3a.zip"
z = zipfile.ZipFile(fetch(URL, "tandeo.zip")); d = RAW / "tandeo"; z.extractall(d)
shp = [p for p in d.rglob("*.shp")][0]
r = shapefile.Reader(str(shp), encoding="utf-8", encodingErrors="replace")
cnt = collections.defaultdict(lambda: {"si": 0, "no": 0, "colonias_tandeo": []})
for rec in r.iterRecords():
    rd = rec.as_dict(); a = (rd.get("DELEGACIO") or rd.get("MUNICIPIO") or "?").strip().upper()
    t = (rd.get("tnd_2019") or "").strip().lower()
    if t == "si": cnt[a]["si"] += 1; cnt[a]["colonias_tandeo"].append(rd.get("NOMBRE"))
    elif t == "no": cnt[a]["no"] += 1
for a, v in cnt.items():
    v["cve_mun"] = N2C.get(norm(a)); v["pct_colonias_tandeo"] = round(100 * v["si"] / max(1, v["si"] + v["no"]), 1); v["colonias_tandeo"].sort()
save("tandeo_2019_alcaldia.json", {"_meta": {"fuente": "Datos Abiertos CDMX – Colonias con distribución de agua por tandeo 2019 (SACMEX)",
     "url": URL, "fecha_corte": "2019", "frecuencia": "estático", "verificado": "HTTP 200 (403 intermitente, reintentar)"},
     "por_cve_mun": {v["cve_mun"]: {"alcaldia": a, **v} for a, v in sorted(cnt.items())}})
