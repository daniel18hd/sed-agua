# brain/ — datos empaquetados + reglas del semáforo (Sed)

Todo lo de `data/` es JSON/GeoJSON estático. Cada archivo trae `_meta` {fuente, url, fecha_corte, frecuencia, verificado}; resumen en `data/manifest.json`.
Regenerar: `bash refresh/refresh_all.sh` (Python 3 + shapely, pyshp, openpyxl, pandas). Si una fuente falla se queda el archivo anterior.

| archivo | qué | corte | script |
|---|---|---|---|
| alcaldias.simplified.geojson | 16 polígonos (22 KB), props cve_mun, nombre, label_lat/lon, bbox | estático | alcaldias.py |
| colonias.simplified.geojson | 1,543 colonias (1.6 MB) solo servidor, point-in-polygon | estático | colonias.py |
| sequia_alcaldias.json | Monitor de Sequía SMN por alcaldía + historial 24 cortes | 2026-10-15 (todas sin sequía) | sequia.py |
| cutzamala_latest.json | presas VV/VB/EB, total 95.12% | 2026-10-26 | cutzamala.py |
| calidad_los_berros.json | calidad a la salida de planta Los Berros vs NOM-127 | 2026-10-26 | cutzamala.py |
| vulnerabilidad_inegi_alcaldia.json | % viviendas sin agua entubada, tinaco, cisterna (mínimos) | 2020-03-15 | inegi.py |
| tandeo_2019_alcaldia.json | colonias con tandeo 2019 por alcaldía + lista de nombres | 2019 | tandeo.py |
| reportes_historicos_alcaldia.json | reportes SACMEX Falta de agua / Mala calidad / Fuga, tasa x1000 viv, p75, top colonias | 2022-01-01 → 2024-02-01 | reportes.py |
| lluvia_7d_alcaldia.json | lluvia 7 días (modelo Open-Meteo, no estación) | 2026-10-29 | lluvia.py |
| abastecimiento_alcaldia.json | alcaldía → sistema (Cutzamala / pozos / Chalmita / La Caldera) | POR VALIDAR (prensa) | abastecimiento.py |
| ruta_agua.geojson | rutas para animación | APROXIMADA / ilustrativa | abastecimiento.py |
| demo-cases.json | 10 casos demo (8 prensa, 2 base histórica) | ver cada caso | (manual) |

Reglas (funciones puras): `rules/semaforo.ts` (`evaluate`), `rules/llegada.ts` (`estimarLlegada`: oficial > ESTIMADO > sin dato), `rules/calidad.ts` (`avisoCalidad`: planta / vecinos / demo) y `rules/whatsapp.ts` (`buildReply`, `assertSafe`). Reportes vecinales = solo texto/ubicación (sin fotos). Tests: `node --test rules/semaforo.test.ts` (Node ≥22.6 con type stripping; en el repo usar vitest si se prefiere).

Advertencias:
- Calidad Los Berros = agua a la salida de planta, NO en la llave. Nunca decir "apta para beber".
- Tandeo 2019 e INEGI 2020 son estructurales (viejos): suman vulnerabilidad, no dicen que hoy falte agua.
- Tasa baja de reportes en una alcaldía puede reflejar canal de reporte, no ausencia de problema.
- Match tandeo↔colonia: por nombre normalizado (sin acentos, mayúsculas) + alcaldía; ~imperfecto.
- API "Agua en tu colonia" (SEGIAGUA) no respondió (SSL/504) al armar esto; el mapeo de abastecimiento queda por validar ahí.
- "Días para que llegue el agua": NO hay dato público en tiempo real por colonia. Solo es "oficial" si hay aviso con fecha fin (SEGIAGUA/alcaldía); si no, rango ESTIMADO con base explícita (`ESTIMADO_EVENTO` en llegada.ts) o "sin dato oficial".
- Azufre/sulfatos: búsqueda 2026-10-30 en Datos CDMX = 0 datasets de agua ("azufre" solo aparece en RAMA, calidad del AIRE). Reportes SACMEX 2022–24 traen "Mala calidad" (3,132) sin parámetro. Los Berros publica turbiedad, color, pH, cloro, dureza, olor y sabor; sin sulfatos. "Agua en tu colonia" (portal SEGIAGUA, responde 200 en web; su API no devolvió datos al box) muestra fuente de suministro, horario de suministro programado y consulta de muestra por folio, no parámetros por colonia. ⇒ "exceso de azufre" en la demo = `escenarios_demo` de demo-cases.json, siempre etiquetado [DEMO].
