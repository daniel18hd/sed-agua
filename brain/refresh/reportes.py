"""Reportes ciudadanos históricos SACMEX (Datos CDMX, datastore) agregados por alcaldía + top colonias 'Falta de agua'."""
import json, urllib.parse, urllib.request, unicodedata
from _common import save, UA, ALC
RID = "a8069e94-c7cb-45d7-8166-561e80884422"
API = "https://datos.cdmx.gob.mx/api/3/action/datastore_search_sql?sql="
def q(sql):
    for _ in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(API + urllib.parse.quote(sql), headers=UA), timeout=120) as r:
                return json.load(r)["result"]["records"]
        except Exception as e: err = e
    raise err
norm = lambda x: "".join(c for c in unicodedata.normalize("NFD", (x or "").upper()) if unicodedata.category(c) != "Mn").strip()
N2C = {norm(v): k for k, v in ALC.items()}; N2C["CUAJIMALPA"] = "004"; N2C["MAGDALENA CONTRERAS"] = "008"
rng = q(f'SELECT MIN(fecha_reporte) a, MAX(fecha_reporte) b FROM "{RID}"')[0]
rows = q(f'SELECT alcaldia_catalogo alc, reporte, COUNT(*) n FROM "{RID}" WHERE reporte IN (\'Falta de agua\',\'Mala calidad\',\'Fuga\') GROUP BY 1,2')
out = {}
for r in rows:
    c = N2C.get(norm(r["alc"]))
    if not c: continue
    o = out.setdefault(c, {"alcaldia": ALC[c], "falta_de_agua": 0, "mala_calidad": 0, "fuga": 0})
    o[{"Falta de agua": "falta_de_agua", "Mala calidad": "mala_calidad", "Fuga": "fuga"}[r["reporte"]]] += int(r["n"])
top = q(f'SELECT alcaldia_catalogo alc, colonia_catalogo col, COUNT(*) n FROM "{RID}" WHERE reporte=\'Falta de agua\' GROUP BY 1,2 ORDER BY 3 DESC LIMIT 400')
for t in top:
    c = N2C.get(norm(t["alc"]))
    if c and t["col"] not in (None, "NA") and len(out[c].setdefault("top_colonias_falta_agua", [])) < 5:
        out[c]["top_colonias_falta_agua"].append({"colonia": t["col"], "n": int(t["n"])})
import pathlib
inegi = json.load(open(pathlib.Path(__file__).parent.parent / "data/vulnerabilidad_inegi_alcaldia.json"))
for c, o in out.items():
    v = inegi["por_cve_mun"].get(c, {}).get("tvivparhab")
    o["falta_por_1000_viviendas"] = round(1000 * o["falta_de_agua"] / v, 1) if v else None
vals = sorted(o["falta_por_1000_viviendas"] for o in out.values() if o["falta_por_1000_viviendas"])
p75 = vals[int(0.75 * (len(vals) - 1))]
for o in out.values(): o["sobre_p75"] = bool(o["falta_por_1000_viviendas"] and o["falta_por_1000_viviendas"] >= p75)
save("reportes_historicos_alcaldia.json", {"_meta": {"fuente": "Datos Abiertos CDMX – Reportes de agua (SACMEX), recurso " + RID,
     "url": "https://datos.cdmx.gob.mx/dataset/reportes-de-agua", "fecha_corte": str(rng["b"])[:10], "frecuencia": "histórico (sin actualización desde 2024)",
     "verificado": f"API datastore_search_sql HTTP 200; rango {str(rng['a'])[:10]} a {str(rng['b'])[:10]}"},
     "p75_falta_por_1000_viviendas": p75, "por_cve_mun": out})
