# Sed: fuentes públicas de datos de agua en México (verificadas el 30 oct 2026, hora CDMX)

Todas las pruebas se hicieron con `curl` desde el box. "HTTP 200" significa que se descargó y se leyó el dato. Los archivos crudos están en `/workspace/hackaton-sed/raw/`.

## 0. Resumen
**No existe un dato público en tiempo real de "calidad del agua en mi llave" ni de "desabasto por colonia/CP" en CDMX.** Lo que sí existe:
- **Real y diario o casi diario:** el Cutzamala (almacenamiento y la calidad en la planta Los Berros, PDF mensual que se actualiza a diario), el pronóstico de lluvia del SMN por alcaldía (API JSON) y la lluvia y humedad de suelo de Open-Meteo y NASA POWER (APIs JSON sin llave).
- **Quincenal:** el Monitor de Sequía de México por municipio o alcaldía (XLSX).
- **Línea base histórica por colonia, AGEB o CP:** reportes ciudadanos de SACMEX (2022 a feb 2024, API CKAN con SQL), 0311 Locatel (con código postal, hasta feb 2024), colonias con tandeo (2019), y el Censo 2020 de INEGI (agua entubada, tinaco y cisterna por AGEB).
- **Hallazgo:** SACMEX ya se llama **SEGIAGUA** (Secretaría de Gestión Integral del Agua). Su portal "Agua en tu colonia" usa una API JSON interna (`/api/v1/...`, incluso `samples/{id}`, que suena a muestras de calidad), pero desde el box la conexión se cortó (SSL EOF o 504). **No está verificada.**

## 1. Fuentes, una por una

| # | Fuente | URL exacta | Qué da | Granularidad | Frecuencia | Formato / llave | ¿Probada? |
|---|---|---|---|---|---|---|---|
| 1 | **Cutzamala, reporte diario (CONAGUA OCAVM)** | Índice: https://www.gob.mx/conagua/documentos/almacenamiento-en-presas-del-sistema-cutzamala · Octubre: https://www.gob.mx/cms/uploads/attachment/file/1112797/Octubre_2026.pdf | Almacenamiento (Mm³ y %) de Villa Victoria, Valle de Bravo, El Bosque y el total, más lluvia. **También** la calidad diaria en la **planta potabilizadora Los Berros** (turbiedad, color, pH, cloro residual, dureza, sabor y olor, frente a la NOM-127) | Sistema / 3 presas / 1 planta | Diaria; el PDF del mes se actualiza varias veces | PDF (se parsea con `pdftotext -layout`), sin llave | ✅ HTTP 200. **Último corte: 26 oct 2026, 744,344,000 m³ = 95.12%** (VV 87.58%, VB 96.78%, EB 98.81%). Los Berros el 26 oct: turbiedad 0.33 UNT, pH 7.05, Cl 1.10 mg/L, "AGRADABLE" |
| 2 | **SINA, Monitoreo de presas (210 presas)** | https://sinav30.conagua.gob.mx:8080/Presas/ · API `http://sinav30.conagua.gob.mx:8080/PresasPG/presas/reporte/YYYY-MM-DD` | % de llenado y volumen por presa | Presa | Era diaria; **congelada desde el 23 abr 2025** (según reservoirs.earth y la prensa) | JSON, sin llave | ❌ HTTPS no conecta y HTTP da **500** para todas las fechas probadas (2024, 2025 y 2026). No sirve |
| 3 | **Monitor de Sequía de México (SMN)** | Página: https://smn.conagua.gob.mx/es/climatologia/monitor-de-sequia/monitor-de-sequia-en-mexico · Datos: https://smn.conagua.gob.mx/tools/RESOURCES/Monitor%20de%20Sequia%20en%20Mexico/MunicipiosSequia.xlsx | Categoría D0–D4 por municipio, histórico desde 2003 | Municipio / alcaldía (2,478) | Quincenal (último corte **15 oct 2026**) | XLSX, sin llave | ✅ HTTP 200, 2.1 MB. **Miguel Hidalgo (9016): celda vacía = sin sequía.** Las 16 alcaldías de CDMX están sin sequía. Último registro de MH: D0 el 15 jul 2024 (D2 de ene a jun 2024). Nacional al corte: 913 D0, 560 D1, 66 D2 |
| 4 | **SMN, API de pronóstico por municipio** | https://smn.conagua.gob.mx/tools/GUI/webservices/?method=1 (diario, 4 días) · `?method=3` (horario) | Precipitación (mm), probabilidad de lluvia, temperaturas máxima y mínima, viento, nubosidad | Municipio / alcaldía (incluye lat/lon) | Diaria | JSON comprimido con gzip (hay que hacer `zcat`), sin llave | ✅ HTTP 200 (321 KB y 7.4 MB). MH 30 oct: prec 0.1 mm, probprec 0%, tmax 24.2, tmin 11.2 |
| 5 | **Open-Meteo** (respaldo de clima) | `https://api.open-meteo.com/v1/forecast?latitude=19.4191&longitude=-99.2191&daily=precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration&hourly=soil_moisture_0_to_1cm&past_days=7&timezone=America%2FMexico_City` · Histórico: `https://archive-api.open-meteo.com/v1/archive?...` | Lluvia pasada y futura, humedad de suelo, evapotranspiración, temperatura y humedad actuales | Punto lat/lon (malla de unos 2–11 km) | Horaria | JSON, sin llave (uso no comercial) | ✅ HTTP 200. Lluvia en CP 11000: 3.8 mm el 27 oct, 0 mm pronosticados del 31 oct al 4 nov. Acumulado del 1 may al 25 oct 2026: 1,167.8 mm |
| 6 | **NASA POWER** (respaldo) | `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR,GWETTOP&community=AG&longitude=-99.2191&latitude=19.4191&start=20261001&end=20261028&format=JSON` | Lluvia y humedad de suelo superficial (GWETTOP 0–1) | Punto (malla de 0.5°) | Diaria, con 2–3 días de retraso | JSON, sin llave | ✅ HTTP 200. GWETTOP ≈0.72 el 27 oct; el 28 oct = -999 (aún sin dato) |
| 7 | **SACMEX, Reportes de agua (ciudadanos)** | https://datos.cdmx.gob.mx/dataset/reportes-de-agua · API: `https://datos.cdmx.gob.mx/api/3/action/datastore_search_sql?sql=...` con resource `a8069e94-c7cb-45d7-8166-561e80884422` (2022–2024) y `65a6b1a6-...` (2018–2021) | Falta de agua, fuga, mala calidad, drenaje, con fecha, colonia y **lat/lon** | Punto / colonia | **Histórico: termina el 1 feb 2024** (313,756 registros) | CKAN datastore JSON + SQL, CSV, sin llave | ✅ HTTP 200. Lomas de Chapultepec I–VIII: falta de agua 371 (2022), 146 (2023) y **284 solo en enero de 2024**; mala calidad 3 / 0 / 2 |
| 8 | **0311 Locatel** | https://datos.cdmx.gob.mx/dataset/0311 · resource 2024 `44913088-806d-4f80-acca-1409a8225e9c` | Solicitudes ciudadanas con tema (FALTA DE AGUA, FUGA DE AGUA, etc.) y **`codigo_postal_solicitud`** | CP / colonia / punto | El recurso de 2024 cubre **solo del 1 ene al 29 feb 2024** | CKAN JSON + SQL, CSV | ✅ HTTP 200. CP 11000, ene–feb 2024: 18 por falta de agua y 33 por fuga. CDMX: 8,295 por falta de agua |
| 9 | **Colonias con tandeo 2019** | https://datos.cdmx.gob.mx/dataset/colonias-con-distribucion-de-agua-por-tandeo-2019 · SHP: `https://datos.cdmx.gob.mx/dataset/cba78780-cdf0-464c-a9c2-3078c0fdf7f1/resource/33808cea-fa25-45db-becd-43d380d65e3a/download/33808cea-fa25-45db-becd-43d380d65e3a.zip` | Si cada colonia tenía tandeo (sí/no) | Colonia (2,399; 273 con tandeo) | Estático (2019) | SHP WGS84 | ✅ HTTP 200 al segundo intento (el primero dio 403). Colonias de CP 11000 (Lomas de Chapultepec, Bosques de las Lomas, Lomas Virreyes): **"no"** |
| 10 | **INEGI Censo 2020, AGEB urbana** | https://www.inegi.org.mx/contenidos/programas/ccpv/2020/datosabiertos/ageb_manzana/ageb_mza_urbana_09_cpv2020_csv.zip · Polígonos AGEB: https://datos.cdmx.gob.mx/dataset/caracteristicas-de-las-viviendas-nivel-ageb-censo-2020 (GeoJSON) | VPH_AGUADV (agua entubada), VPH_AEASP (servicio público), VPH_AGUAFV (sin agua entubada), VPH_TINACO, VPH_CISTER y POBTOT | AGEB / manzana | Estático (2020) | CSV ZIP + GeoJSON, sin llave. La API de indicadores de INEGI **pide token** y sin token dio 404 | ✅ HTTP 200 (13 MB). 21 AGEB en CP 11000: 24,246 habitantes, 7,991 viviendas; 7,505 con agua entubada, 6,346 con tinaco y 6,011 con cisterna (algunas celdas censuradas con `*`). CDMX: 20,736 viviendas sin agua entubada |
| 11 | **CONAGUA, calidad del agua (RENAMECA)** | https://datos.conagua.gob.mx/views/index_datos_abiertos.html · `https://datos.conagua.gob.mx/docs/DatosAbiertos/Indicadores_de_calidad_del_agua_2023_en_1056_sitios_de_monitoreo.zip` | **Semáforo** verde/amarillo/rojo y contaminantes de ríos, presas y pozos | Sitio de monitoreo (punto) | Anual (2023) | CSV + KMZ, sin llave | ✅ HTTP 200. **Ningún sitio está en CDMX** (606 subterráneos, 450 superficiales). Hay pozos en Edomex. Sirve para la capa nacional del mapa, no para CP 11000 |
| 12 | **CP de CDMX (GeoJSON)** | https://datos.cdmx.gob.mx/dataset/codigos-postales · `https://datos.cdmx.gob.mx/dataset/7abff432-81a0-4956-8691-0865e2722423/resource/95482697-af9d-440a-a65b-4d289e5fcd5c/download/95482697-af9d-440a-a65b-4d289e5fcd5c.json` | Polígono de cada CP (`d_cp`) | CP (1,215) | Estático | GeoJSON 5.3 MB | ✅ HTTP 200. CP 11000: centroide 19.4191, -99.2191, unos 6 km²; cubre Lomas de Chapultepec I a VIII Sección |
| 13 | **Colonias de CDMX (GeoJSON)** | https://datos.cdmx.gob.mx/dataset/catalogo-de-colonias-datos-abiertos · `.../resource/026b42d3-a609-44c7-a83d-22b2150caffc/download/026b42d3-a609-44c7-a83d-22b2150caffc.json` | Polígono, colonia, alcaldía y `cve_col` | Colonia (1,543) | Estático | GeoJSON 10 MB | ✅ HTTP 200 |
| 14 | **"Agua en tu colonia" (SEGIAGUA)** | https://aguaentucolonia.sacmex.cdmx.gob.mx/#/home · API interna en su JS: `https://aguaentucolonia.sacmex.cdmx.gob.mx/api/v1/municipalities/WaterInYourSettlement`, `/settlements/getSettlementsByMunicipalityIdForWaterInYourSettlement/{id}`, `/settlements/getWellsBySettlementId/{id}`, `/samples/{id}` | Estado del suministro por colonia, fuente (pozos) y posiblemente muestras de calidad | Colonia | Supuestamente actual | JSON no documentado | ⚠️ El HTML responde 200, pero la API **no respondió** (SSL EOF desde el box y 504 desde el fetcher). **NO verificada.** Antes de usarla, probar desde un navegador o una red mexicana, y preferir pedir permiso o acceso oficial |
| 15 | Otros datasets de CDMX (consumo por colonia, contaminación de agua, fugas 2007–2015, pozos, garzas de pipas) | https://datos.cdmx.gob.mx/api/3/action/package_search?q=agua (44 datasets) | Capas estáticas para el look del mapa | Colonia / punto | Estáticos | CSV / GeoJSON / SHP | Catálogo ✅ 200. Algunas descargas dieron 403 intermitente. **Ojo:** varios recursos traen la URL interna `http://10.80.148.134/...`; hay que reemplazarla por `https://datos.cdmx.gob.mx/...` |
| 16 | COFEPRIS / Semarnat | — | COFEPRIS publica calidad de agua de **playas** (bacteriología), no de la red urbana. Semarnat no tiene un semáforo de red urbana | — | — | — | No probada (no aplica a CP 11000) |
| 17 | Copernicus (ERA5, Sentinel) / NASA GPM IMERG | cds.climate.copernicus.eu · gpm.nasa.gov | Lluvia y humedad satelital | Malla | Horaria / diaria | **Requiere cuenta o llave** | No probada. Open-Meteo y NASA POWER cubren lo mismo sin llave |

Notas: el SMN tiene páginas con error 500 intermitente (EMAs, PDF del MSM). El XLSX municipal y la API funcionaron. En Datos CDMX, los reportes ciudadanos llegan solo hasta feb 2024.

## 2. "¿Qué le decimos hoy a alguien en CP 11000?" (con los datos al 30 oct 2026)
**Dato real verificable (citar fuente y fecha):**
- Zona: Lomas de Chapultepec I–VIII Secc., Miguel Hidalgo (polígono CP de Datos CDMX).
- Sequía: **Miguel Hidalgo sin sequía** (Monitor de Sequía SMN, corte 15 oct 2026). En 2024 estuvo en D2, sequía severa.
- Fuente regional: **Cutzamala al 95.12%** (26 oct 2026), contra 97.4% hace un año (según ComoVa.MX, que cita a CONAGUA).
- Calidad en planta: Los Berros (Cutzamala) dentro de la NOM-127 el 26 oct (turbiedad 0.33 UNT, pH 7.05, cloro 1.10 mg/L). **Es agua de planta, no de su llave**, y no sabemos qué fracción de las Lomas recibe agua del Cutzamala y cuánta de pozos.
- Clima: 0 mm de lluvia pronosticada del 31 oct al 4 nov (SMN / Open-Meteo); empieza la temporada seca.
- Contexto: el 94% de las viviendas tiene agua entubada en la vivienda o el terreno, el 79% tinaco y el 75% cisterna (INEGI 2020, 21 AGEB). Sin tandeo programado en 2019.

**Estimación derivada (decirla como estimación):**
- Riesgo de desabasto para las próximas semanas: **BAJO**. Sin sequía, Cutzamala por arriba del 90% y sin historial de tandeo. Matiz: las Lomas sí tuvieron picos de reportes por falta de agua (284 en enero de 2024, en plena sequía), así que la zona es sensible cuando baja el Cutzamala.
- Tendencia: noviembre a mayo es temporada seca, cuando el Cutzamala suele empezar a bajar (patrón histórico, no verificado en esta sesión).

**Lo que NO existe en tiempo real (decirlo explícitamente):**
- Calidad del agua en la llave por colonia o CP.
- Presión o cortes en vivo por colonia en datos abiertos (solo los avisos de SEGIAGUA en redes sociales y el portal no verificado).
- Reportes ciudadanos recientes: los datos abiertos de SACMEX y 0311 llegan hasta feb 2024. **Ese hueco lo llena Sed con sus propios reportes de WhatsApp.**
- Una proyección oficial de desabasto por colonia.

## 3. Clasificación propuesta (semáforo, con reglas exactas)
Cada respuesta se calcula por colonia (el CP se pasa a colonia con point-in-polygon) y para una ventana de tiempo.

**Señales (cada una con fuente, fecha y peso):**
- S1 Sequía (MSM, alcaldía): ninguna = 0, D0 = 1, D1 = 2, D2+ = 3.
- S2 Cutzamala (% total): ≥80% = 0, 60–80% = 1, 40–60% = 2, <40% = 3. *Solo aplica en el Valle de México.*
- S3 Lluvia (SMN/Open-Meteo, 7 días pasados + 7 futuros): ≥10 mm = 0, <10 mm en temporada seca = 0, <10 mm en temporada de lluvias (jun–oct) = 1.
- S4 Vulnerabilidad estructural (estática): tandeo en 2019 = +1; % sin agua entubada en las AGEB > 5% = +1; percentil 75 o más de reportes históricos de "Falta de agua" por vivienda en SACMEX = +1.
- C Reportes ciudadanos de Sed (en vivo): N = reportes únicos (1 por número de WhatsApp) de "sin agua" en la colonia en las últimas 24 h. Cada reporte cuenta 1 (solo texto/ubicación; las fotos se descartaron el 30-oct-2026, ver PRD).

**Reglas:**
- 🔴 **ROJO, "Crisis confirmada":** C ≥ 5 reportes únicos en 24 h **y** (S1+S2 ≥ 2 **o** C ≥ 15). O bien un aviso oficial de corte vigente (si se integra la fuente de SEGIAGUA).
- 🟠 **ÁMBAR, "Riesgo / reportes sin confirmar":** C entre 2 y 4 en 24 h, **o** S1+S2+S3+S4 ≥ 3 sin reportes.
- 🟢 **VERDE, "Sin señales de desabasto":** C ≤ 1 **y** S1+S2+S3+S4 ≤ 2.
- ⚪ **GRIS, "Sin datos suficientes":** la fuente oficial no se pudo consultar o tiene más de 30 días, y no hay reportes. **No se inventa nada.**
- La calidad va aparte, nunca como un "apta para beber": muestra "Planta Los Berros dentro de norma (fecha)" o "N vecinos reportan agua turbia en 24 h". Con 3 o más reportes únicos de "turbia o con olor", se marca la colonia en ámbar de calidad, con el texto "reportes ciudadanos, sin análisis de laboratorio".

**Cómo garantizar que el output tenga valor y no sea inventado:**
1. Cada línea de la respuesta de WhatsApp lleva **fuente y fecha de corte**, por ejemplo: "Cutzamala 95.1% (CONAGUA, 26 oct)".
2. Separar visualmente lo **Oficial**, lo **Estimado** y lo **Reportado por vecinos**.
3. Dar un nivel de confianza: alta si hay 2 o más fuentes oficiales con menos de 15 días y C es coherente; media si solo hay una; baja si solo hay reportes.
4. Usar la frase fija "No hay dato oficial en tiempo real de X para tu colonia" cuando aplique.
5. El LLM **solo redacta** a partir de un JSON calculado con reglas; no puede añadir cifras que no estén en ese JSON.
6. Cerrar con una acción útil: "Pide pipa gratis: *426 (Línea H2O) o *0311 / 55 5658 1111" (los números vienen de la prensa; verificarlos en segiagua.cdmx.gob.mx), además de "¿Tú tienes agua? Responde 1 sí / 2 no / 3 turbia".
7. Los datos sintéticos del demo se etiquetan como "simulado" en el OS.

## 4. Las 5 fuentes más fáciles de integrar en 48 h (en orden)
1. **CP y colonias en GeoJSON** (Datos CDMX, #12 y #13): carga única para pasar dirección o CP a colonia y alcaldía. Es la base del mapa.
2. **API de pronóstico del SMN** `https://smn.conagua.gob.mx/tools/GUI/webservices/?method=1` (gzip JSON, filtrar `ides=9`, `idmun`), con **Open-Meteo** como respaldo por lat/lon. Se refresca cada hora en el cron.
3. **Monitor de Sequía XLSX** (`MunicipiosSequia.xlsx`): leer la última columna y hacer join por `CVE_CONCATENADA` (9002–9017). Cron diario; cambia cada quincena. Además da la capa nacional por municipio para el globo.
4. **Cutzamala PDF** (índice en gob.mx → PDF del mes → `pdftotext -layout` → última fila con datos). Cron cada 6 h. Da el "contador gigante" y la calidad de Los Berros.
5. **Línea base de Datos CDMX** (CKAN SQL): reportes de SACMEX (lat/lon, para un heatmap histórico 2022–24), tandeo 2019 (SHP) y INEGI AGEB (viviendas sin agua, tinaco y cisterna). Se precalculan una vez por colonia y se guardan en Supabase.
   - Extra para el mapa nacional: CONAGUA RENAMECA 2023 (semáforo de 1,056 sitios, CSV con lat/lon).
   - Aparte: probar "Agua en tu colonia" (#14) desde un navegador. Si responde, es la única fuente cercana al tiempo real por colonia, pero es una API no documentada; para producción conviene pedir acceso a SEGIAGUA.

Ejemplo de consulta SQL a CKAN:
```
curl -G https://datos.cdmx.gob.mx/api/3/action/datastore_search_sql --data-urlencode \
 "sql=SELECT colonia_catalogo, COUNT(*) n FROM \"a8069e94-c7cb-45d7-8166-561e80884422\" WHERE reporte='Falta de agua' GROUP BY 1 ORDER BY 2 DESC"
```
