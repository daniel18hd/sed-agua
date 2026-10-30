"""Almacenamiento Cutzamala + calidad planta Los Berros (CONAGUA OCAVM, PDF mensual).
Uso: python3 cutzamala.py [URL_PDF]  (si no se da, intenta descubrir el PDF del mes desde la página índice)."""
import re, sys, subprocess, urllib.request
from _common import fetch, save, RAW, UA
INDEX = "https://www.gob.mx/conagua/documentos/almacenamiento-en-presas-del-sistema-cutzamala"
DEFAULT = "https://www.gob.mx/cms/uploads/attachment/file/1112797/Octubre_2026.pdf"
url = sys.argv[1] if len(sys.argv) > 1 else None
if not url:
    try:
        html = fetch(INDEX, "cutz_index.html").read_text(errors="ignore")
        links = re.findall(r'href="(/cms/uploads/attachment/file/\d+/[^"]+\.pdf)"', html)
        url = "https://www.gob.mx" + links[0] if links else DEFAULT
    except Exception:
        url = DEFAULT
pdf = fetch(url, "cutz.pdf")
txt = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, text=True).stdout
mes = re.search(r"\n\s*(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s", txt)
year = re.search(r"CUTZAMALA (\d{4})", txt)
alm, cal = [], []
part_cal = txt.split("LOS BERROS")
num = r"([\d,]+\.?\d*)"
for line in part_cal[0].splitlines():
    m = re.match(r"^\s*(\d{1,2})\s+" + r"\s+".join([num]*11) + r"\s*$", line)
    if m:
        g = [x.replace(",", "") for x in m.groups()]
        alm.append({"dia": int(g[0]), "villa_victoria": {"mm3": float(g[1]), "pct": float(g[2]), "lluvia_mm": float(g[3])},
                    "valle_de_bravo": {"mm3": float(g[4]), "pct": float(g[5]), "lluvia_mm": float(g[6])},
                    "el_bosque": {"mm3": float(g[7]), "pct": float(g[8]), "lluvia_mm": float(g[9])},
                    "total_m3": int(float(g[10])), "total_pct": float(g[11])})
if len(part_cal) > 1:
    for line in part_cal[1].splitlines():
        m = re.match(r"^\s*(\d{1,2})\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+(\S+)\s*$", line)
        if m:
            g = m.groups()
            cal.append({"dia": int(g[0]), "turbiedad_unt": float(g[1]), "color_upt_co": float(g[2]), "ph": float(g[3]),
                        "cloro_residual_mg_l": float(g[4]), "dureza_mg_l": float(g[5]), "sabor": g[6], "olor": g[7]})
M = {"ENERO":1,"FEBRERO":2,"MARZO":3,"ABRIL":4,"MAYO":5,"JUNIO":6,"JULIO":7,"AGOSTO":8,"SEPTIEMBRE":9,"OCTUBRE":10,"NOVIEMBRE":11,"DICIEMBRE":12}
mm = M[mes.group(1)] if mes else None; yy = int(year.group(1)) if year else None
fecha = lambda d: f"{yy}-{mm:02d}-{d:02d}" if yy and mm else None
assert alm, "No se parseó ninguna fila de almacenamiento"
last = alm[-1]
LIM = {"turbiedad_unt": [None, 5.0], "color_upt_co": [None, 20.0], "ph": [6.5, 8.5], "cloro_residual_mg_l": [0.2, 1.5], "dureza_mg_l": [None, 500]}
def dentro(r):
    fuera = [k for k, (lo, hi) in LIM.items() if (lo is not None and r[k] < lo) or (hi is not None and r[k] > hi)]
    if r["sabor"] != "AGRADABLE" or r["olor"] != "AGRADABLE": fuera.append("sabor/olor")
    return fuera
meta = {"fuente": "CONAGUA OCAVM – Almacenamiento en presas del Sistema Cutzamala (PDF)", "url": url,
        "fecha_corte": fecha(last["dia"]), "frecuencia": "diaria (PDF mensual actualizado con rezago de días)",
        "verificado": "HTTP 200 30-oct-2026, parseado con pdftotext"}
save("cutzamala_latest.json", {"_meta": meta, "capacidad_total_mm3": 782.521,
     "ultimo": {**last, "fecha": fecha(last["dia"])}, "inicio_mes": {**alm[0], "fecha": fecha(alm[0]["dia"])},
     "serie_mes": [{"fecha": fecha(a["dia"]), "total_pct": a["total_pct"]} for a in alm],
     "presas_coords_aprox": {"villa_victoria": [19.4622, -99.9833], "valle_de_bravo": [19.1960, -100.155], "el_bosque": [19.3924, -100.397],
                             "_nota": "coordenadas APROXIMADAS del cuerpo de agua (OpenStreetMap/Nominatim, consultado 2026-10-30), solo para visualización"}})
if cal:
    lc = cal[-1]
    save("calidad_los_berros.json", {"_meta": {**meta, "fuente": "CONAGUA OCAVM – Reporte diario de calidad del agua, Planta Potabilizadora Los Berros (NOM-127-SSA1-1994 mod. 2000)",
         "fecha_corte": fecha(lc["dia"])}, "limites_nom127": LIM,
         "ultimo": {**lc, "fecha": fecha(lc["dia"]), "parametros_fuera_de_norma": dentro(lc)},
         "serie_mes": [{**c, "fecha": fecha(c["dia"]), "parametros_fuera_de_norma": dentro(c)} for c in cal],
         "advertencia": "Calidad A LA SALIDA DE LA PLANTA, no en la toma domiciliaria. Nunca comunicar como 'apta para beber'."})
