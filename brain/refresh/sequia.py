"""Monitor de Sequía de México (SMN/CONAGUA) por alcaldía CDMX. Quincenal."""
import pandas as pd, math
from _common import fetch, save, ALC
URL = "https://smn.conagua.gob.mx/tools/RESOURCES/Monitor%20de%20Sequia%20en%20Mexico/MunicipiosSequia.xlsx"
p = fetch(URL, "MunicipiosSequia.xlsx")
df = pd.read_excel(p, sheet_name="MUNICIPIOS")
datecols = [c for c in df.columns if hasattr(c, "year") or str(c)[:2] == "20"]
datecols = sorted(datecols, key=lambda c: pd.Timestamp(c))
last = datecols[-1]
cvecol = [c for c in df.columns if "CVE_CONCATENADA" in str(c)][0]
out = {}
for cve, name in ALC.items():
    row = df[df[cvecol].astype(int) == int("9" + cve)]
    if row.empty: continue
    r = row.iloc[0]
    def v(c):
        x = r[c]; return None if (x is None or (isinstance(x, float) and math.isnan(x))) else str(x)
    hist = [{"fecha": str(pd.Timestamp(c).date()), "cat": v(c)} for c in datecols[-24:]]
    out[cve] = {"alcaldia": name, "categoria": v(last), "historial_12m": hist}
save("sequia_alcaldias.json", {"_meta": {"fuente": "SMN-CONAGUA Monitor de Sequía de México", "url": URL,
    "fecha_corte": str(pd.Timestamp(last).date()), "frecuencia": "quincenal",
    "verificado": "HTTP 200; categoria null = sin sequía (celda vacía en el XLSX)"}, "por_cve_mun": out})
