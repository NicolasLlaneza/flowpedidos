# Reglas de decisión — Ronda 2 del panel de evaluación

**Fecha de fijación:** 2026-09-15
**Estado del instrumento al momento de fijación:** protocolo pusheado (commit `094a59c`, 2026-09-14 12:15 UTC), corpus balanceado generado a partir de la corrida definitiva v2 del 2026-09-15, formulario **no creado aún**, cero respuestas recolectadas.

Este documento fija — antes de crear el formulario y de mirar cualquier respuesta — las reglas de cierre y las reglas de análisis de la ronda 2 del panel. La finalidad es blindar la ronda contra optional stopping y contra selección post-hoc del análisis.

## 1. Regla de cierre

La recolección se cierra al ocurrir el primero de estos dos eventos, y **sólo entonces** se ejecuta el análisis:

- **N = 10 respuestas** completas (una por persona, verificada por la restricción del formulario) ; **o**
- **48 horas** contadas desde el momento en que se comparte por primera vez el enlace publicado del formulario con la lista de evaluadores.

Sea cual sea el número de respuestas al momento del cierre — llamémoslo `N_final` — es el que se analiza. No se prorroga, no se resortea, no se pide "una más".

## 2. Regla de estado del análisis según `N_final`

- **`N_final ≥ 6`.** La ronda 2 se reporta como **fuente principal** de evidencia para H3 en el Capítulo 5 (§5.4), en las limitaciones del Capítulo 6 (§6.4) y en el Anexo G. La ronda 1 (k=4) queda como referencia histórica en el Anexo, con la comparación entre ambas rondas explicitada en §5.4.

- **`N_final ≤ 5`.** La ronda 2 se reporta como **evidencia complementaria** — con `N` explícito, sin inferencia — y la ronda 1 sigue siendo la fuente principal para H3, con sus limitaciones declaradas tal como estaban en la versión previa. La ronda 2 aporta las mejoras metodológicas (calibración previa, corpus cruzado por estado) como contribución instrumental al Anexo, no como evidencia estadística nueva.

## 3. Reglas de análisis (pre-especificadas)

- **α = 0.05**, dos colas.
- **Acuerdo inter-evaluador**: ICC(2, k) para acuerdo absoluto entre `N_final` jueces, complementado con alfa de Krippendorff para datos ordinales.
- **Contraste principal**: Mann-Whitney U comparando la mediana de puntaje agregado (promedio de los cuatro criterios) entre el brazo del modelo y el brazo de plantilla, sobre el corpus completo.
- **Contraste secundario**: Wilcoxon pareado por estado canónico si `N_final ≥ 6` y si el corpus mantiene la estructura cruzada del diseño (2 modelo + 1 plantilla por estado). Si no, se omite y se explicita en la redacción.
- **Reporte obligatorio en cualquier caso**: `N_final`, ICC(2, k) con su IC 95 %, alfa exacto, U y p-valor exacto, tamaño de efecto (r = Z / √N para el contraste global, r pareado para Wilcoxon si aplica).

## 4. Reglas de mirada única

- **No se abre ninguna respuesta ni ningún export intermedio antes del cierre.** No hay chequeo de progreso sobre los puntajes: se puede monitorear la cantidad de respuestas para saber cuándo se llega a `N = 10`, pero no se lee ninguna fila del CSV hasta que el cierre esté declarado.
- El análisis se ejecuta **una sola vez** al cierre, con `analyze_panel_v2.py` y las banderas por defecto. Si algún resultado del análisis parece anómalo, se investiga desde el diseño y desde la instrumentación — no se re-ejecuta con parámetros alternativos hasta que "quede mejor".
- Cualquier decisión adicional que se tome tras ver los resultados se **declara** como decisión post-hoc en la sección correspondiente. No se presenta como parte del protocolo.

## 5. Documentación en el TFI

- Este archivo se referencia desde §3.7 del Capítulo 3 como declaración de plan de análisis pre-registrado.
- En §5.4 se reporta el resultado según la regla del punto 2.
- En §6.4 y en el Anexo G se comentan las limitaciones observadas del instrumento sin cambiar el status del punto 2.
- Si `N_final < 3` — es decir, si no hay suficientes jueces para calcular ICC — la ronda 2 se declara **fallida** y sólo la ronda 1 sostiene H3. Este es un escenario borde que se declara aquí para completitud.

## 6. Semilla y reproducibilidad del corpus

El corpus balanceado se generó con `scripts/panel/build-corpus-balanceado.mjs` a partir de la corrida definitiva v2 (2026-09-15). La semilla del shuffle está fija en el script; volver a ejecutarlo sobre la misma base de datos produce el mismo `corpus_blind_v2.csv` y la misma `corpus_key_v2.csv`. Cualquier revisor externo puede reproducirlo con:

```bash
cd scripts/panel
node build-corpus-balanceado.mjs
```

y comparar `corpus_key_v2.csv` byte a byte contra el commit correspondiente.

---

Cualquier violación de estas reglas invalida el uso de la ronda 2 como evidencia principal. En caso de duda, aplica el punto 4: la ronda 2 baja a complementaria y la ronda 1 sostiene H3.
