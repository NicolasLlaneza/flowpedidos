# Reglas de decisión — Ronda 3 del panel de evaluación

**Estado al fijar estas reglas:** corpus generado, formulario **no creado**, cero
respuestas. Este archivo se commitea y se pushea **antes** de compartir el
enlace del formulario; la fecha del commit es la que acredita el preregistro.

## 0. Por qué existe esta ronda

La devolución del tribunal (v23, hallazgo NC-02) observó que en la ronda 2 los
mensajes del modelo conservaban el saludo con el nombre del destinatario y los
de plantilla no llevaban saludo. El origen era reconocible y la personalización
nominal, que aporta un paso determinístico del pipeline y no el modelo, quedaba
confundida con el origen. Esta ronda repite el contraste con esa variable
controlada.

## 1. Diseño

- **Corpus:** 18 mensajes, 2 del modelo y 1 de plantilla por cada uno de los seis
  estados despachables (`paid`, `pending_payment`, `shipped`, `delivered`,
  `cancelled`, `refunded`). Mensajes del modelo tomados de la corrida reportada
  en el Capítulo 5; plantillas verbatim de `n8n-workflows/lib/fallback-template.js`.
- **Saludo:** retirado en ambos brazos. El panel evalúa solo el cuerpo del mensaje.
- **Selección:** `build-corpus-r3.mjs`, semilla 2026, sobre los mensajes
  ordenados por `notif_id`. Es determinística: reejecutarla da el mismo corpus.
- **Instrumento:** rúbrica del Anexo D, calibración previa con dos ejemplos
  (también sin saludo) e ítem de conjetura de origen al final, en una sección
  separada que se responde después de puntuar.
- **Evaluadores:** externos al equipo de tesis. Pueden haber participado en la
  ronda 2; lo declaran en el formulario y se analiza aparte (punto 4).

## 2. Regla de cierre

La recolección se cierra al ocurrir primero: **N = 12 respuestas completas**, o
**72 horas** desde el primer envío del enlace. Se analiza el `N_final` que haya en
ese momento, sin prórroga.

- `N_final ≥ 6`: la ronda 3 es la fuente principal de H3 y la ronda 2 queda como
  antecedente.
- `3 ≤ N_final ≤ 5`: se reporta como complementaria, sin juicio de contrastación.
- `N_final < 3`: ronda fallida; H3 se sigue reportando con la ronda 2 y su reserva.

Una respuesta de un integrante del equipo se excluye antes del análisis. Ninguna
otra exclusión está permitida.

## 3. Análisis preespecificado

1. **Contraste principal:** U de Mann-Whitney sobre el puntaje de panel por
   mensaje (promedio de evaluadores del promedio de los cuatro criterios), 12
   contra 6, **p exacto por enumeración**, dos colas, α = 0,05. Tamaño de efecto:
   delta de Cliff.
2. **Contraste secundario:** Wilcoxon de rangos con signo sobre los seis pares por
   estado (promedio de los dos mensajes del modelo contra la plantilla), p exacto.
3. **Acuerdo:** ICC(2,k) de acuerdo absoluto con IC 95 % (principal), ICC(2,1),
   ICC(3,1) y alfa de Krippendorff ordinal sobre los valores crudos.
4. **Verificación del enmascaramiento:** proporción de aciertos en la conjetura de
   origen sobre las respuestas comprometidas (se excluyen los «No sé»), contra el
   azar de 1/3 con binomial exacta de cola superior. El enmascaramiento se
   considera **comprometido** si la tasa supera el 50 % y p < 0,05.
5. **Veredicto sobre H3:**
   - **validada** si el contraste principal es significativo a favor del modelo y
     el enmascaramiento no está comprometido;
   - **compatible** si es significativo pero el enmascaramiento está comprometido;
   - **no sostenida** si el contraste principal no es significativo.

## 4. Análisis de sensibilidad (se reportan, no cambian el veredicto)

- Sin los evaluadores cuya tasa individual de acierto de origen supera el 50 %.
- Sin los evaluadores que declararon participación previa.
- Por criterio: medias y delta de Cliff de los cuatro criterios, con especial
  atención a relevancia contextual, que es el criterio afectado por NC-02.

## 5. Mirada única

No se abre ninguna fila de respuestas antes del cierre; solo se mira el contador.
El análisis se ejecuta una vez con `analyze_panel_r3.py` y sus opciones por
defecto. Cualquier análisis adicional se declara como post hoc.

## 6. Qué se publica

Antes de la recolección: este archivo, los scripts y `corpus_blind_r3.csv`.
Después del cierre: `corpus_key_r3.csv`, las respuestas con los correos
reemplazados por E1…En (`--publicar`) y la salida del análisis. El mapa
seudónimo → correo no se versiona.
