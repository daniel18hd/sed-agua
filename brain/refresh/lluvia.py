"""Lluvia acumulada últimos 7 días por alcaldía (Open-Meteo, modelo; NO es estación oficial SMN). Para runtime usar el mismo endpoint con cache 1 h."""
import json, pathlib, urllib.request
from _common import save, UA
D = pathlib.Path(__file__).parent.parent / "data"
alc = [f["properties"] for f in json.load(open(D / "alcaldias.simplified.geojson"))["features"]]
url = ("https://api.open-meteo.com/v1/forecast?daily=precipitation_sum&past_days=7&forecast_days=1&timezone=America%2FMexico_City"
       "&latitude=" + ",".join(str(a["label_lat"]) for a in alc) + "&longitude=" + ",".join(str(a["label_lon"]) for a in alc))
res = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60))
res = res if isinstance(res, list) else [res]
out = {}
for a, r in zip(alc, res):
    d = r["daily"]; past = [x or 0 for x in d["precipitation_sum"][:-1]]
    out[a["cve_mun"]] = {"alcaldia": a["nombre"], "mm_7d": round(sum(past), 1), "serie": dict(zip(d["time"][:-1], past))}
save("lluvia_7d_alcaldia.json", {"_meta": {"fuente": "Open-Meteo Forecast API (past_days=7), punto de etiqueta de cada alcaldía", "url": url.split("&latitude")[0],
     "fecha_corte": res[0]["daily"]["time"][-2], "frecuencia": "horaria (cachear 1 h)", "verificado": "HTTP 200; dato modelado, no estación"}, "por_cve_mun": out})
