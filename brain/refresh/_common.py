"""Utilidades comunes para los scripts de refresh del cerebro de Sed."""
import json, os, datetime, urllib.request, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = ROOT / "raw_cache"
DATA.mkdir(exist_ok=True); RAW.mkdir(exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (Sed hackathon data refresh)"}

def fetch(url, dest, timeout=120, retries=3):
    """Descarga url a raw_cache/dest (reintenta; Datos CDMX da 403 intermitente)."""
    p = RAW / dest
    last = None
    for _ in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                p.write_bytes(r.read())
            return p
        except Exception as e:  # noqa
            last = e
    if p.exists():
        print(f"WARN: {url} falló ({last}); uso caché {p}")
        return p
    raise RuntimeError(f"No se pudo descargar {url}: {last}")

def now():
    return datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-6))).isoformat(timespec="minutes")

def save(name, obj):
    (DATA / name).write_text(json.dumps(obj, ensure_ascii=False, indent=1))
    man_p = DATA / "manifest.json"
    man = json.loads(man_p.read_text()) if man_p.exists() else {}
    meta = obj.get("_meta", {}) if isinstance(obj, dict) else {}
    man[name] = {k: meta.get(k) for k in ("fuente", "url", "fecha_corte", "frecuencia", "verificado")}
    man[name]["generado"] = now()
    man_p.write_text(json.dumps(man, ensure_ascii=False, indent=1))
    print("OK", name)

ALC = {"002":"Azcapotzalco","003":"Coyoacán","004":"Cuajimalpa de Morelos","005":"Gustavo A. Madero",
"006":"Iztacalco","007":"Iztapalapa","008":"La Magdalena Contreras","009":"Milpa Alta","010":"Álvaro Obregón",
"011":"Tláhuac","012":"Tlalpan","013":"Xochimilco","014":"Benito Juárez","015":"Cuauhtémoc",
"016":"Miguel Hidalgo","017":"Venustiano Carranza"}
