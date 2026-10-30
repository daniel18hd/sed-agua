"""Vulnerabilidad estructural: INEGI Censo 2020, AGEB urbana CDMX, agregado por alcaldía."""
import zipfile, io, pandas as pd
from _common import fetch, save, ALC
URL = "https://www.inegi.org.mx/contenidos/programas/ccpv/2020/datosabiertos/ageb_manzana/ageb_mza_urbana_09_cpv2020_csv.zip"
z = zipfile.ZipFile(fetch(URL, "inegi_ageb09.zip", timeout=300))
name = [n for n in z.namelist() if n.endswith(".csv") and "conjunto_de_datos" in n][0]
df = pd.read_csv(io.BytesIO(z.read(name)), encoding="latin1", dtype=str)
df.columns = [c.replace("\ufeff", "").replace("ï»¿", "") for c in df.columns]
df = df[(df.MZA == "000") & (df.AGEB != "0000") & (df.MUN != "000")]
F = ["POBTOT", "TVIVPARHAB", "VPH_AGUADV", "VPH_AEASP", "VPH_AGUAFV", "VPH_TINACO", "VPH_CISTER"]
for c in F: df[c] = pd.to_numeric(df[c], errors="coerce")  # '*' = dato reservado -> NaN
out = {}
for cve, g in df.groupby("MUN"):
    s = g[F].sum(min_count=1)
    v = s["TVIVPARHAB"]
    out[cve] = {"alcaldia": ALC.get(cve), "agebs": int(len(g)), **{k.lower(): int(s[k]) for k in F},
                "pct_sin_agua_entubada": round(100 * s["VPH_AGUAFV"] / v, 2), "pct_tinaco": round(100 * s["VPH_TINACO"] / v, 1),
                "pct_cisterna": round(100 * s["VPH_CISTER"] / v, 1)}
save("vulnerabilidad_inegi_alcaldia.json", {"_meta": {"fuente": "INEGI Censo de Población y Vivienda 2020, AGEB urbana (CDMX)",
    "url": URL, "fecha_corte": "2020-03-15", "frecuencia": "estático (censo)",
    "verificado": "HTTP 200; suma de AGEB urbanas; celdas '*' (reservadas) excluidas => cifras son mínimos"},
    "campos": {"vph_aguadv": "viviendas con agua entubada en el ámbito de la vivienda (dentro o en patio/terreno)", "vph_aguafv": "viviendas SIN agua entubada en el ámbito de la vivienda",
               "vph_aeasp": "agua entubada del servicio público", "vph_tinaco": "con tinaco", "vph_cister": "con cisterna o aljibe"},
    "por_cve_mun": out})
