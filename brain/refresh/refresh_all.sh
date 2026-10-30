#!/usr/bin/env bash
# Regenera brain/data. Orden importa (alcaldías primero; reportes usa INEGI; rutas usan cutzamala).
set -u; cd "$(dirname "$0")"
for s in alcaldias colonias sequia cutzamala inegi tandeo reportes lluvia abastecimiento; do
  echo "== $s"; python3 "$s.py" || echo "!! $s falló: se conserva el archivo anterior"
done
