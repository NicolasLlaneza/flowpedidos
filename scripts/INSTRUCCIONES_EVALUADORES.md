# Panel de evaluación de calidad comunicacional — Instrucciones para evaluadores

Gracias por participar como evaluador/a externo/a de este Trabajo Final Integrador. Tu tarea es puntuar 20 mensajes cortos de atención al cliente, sin saber cuáles fueron generados por un modelo de lenguaje y cuáles por una plantilla fija — esa información se mantiene deliberadamente oculta para que la evaluación sea a ciegas.

## Qué vas a hacer

1. Abrí el archivo `scoring_evaluador_N.csv` que te corresponde (te va a llegar con tu número asignado).
2. Para cada uno de los 20 mensajes (columna `mensaje`), completá las columnas `claridad_1a5`, `tono_1a5`, `relevancia_1a5` y `correccion_1a5` con un puntaje entero del 1 al 5, según los descriptores de la rúbrica más abajo.
3. No compartas tus puntajes con los otros dos evaluadores antes de que los tres hayan terminado — el objetivo es medir el acuerdo *independiente* entre evaluadores.
4. No hace falta que sepas nada del proyecto ni de cómo se generó cada mensaje — de hecho, es mejor que no lo sepas hasta después de puntuar.

## Rúbrica

### 1. Claridad
Evalúa si el mensaje transmite la información relevante de manera comprensible, sin ambigüedades ni redundancias.

| Nivel | Descriptor |
|---|---|
| 1 | Mensaje confuso o ambiguo; no se puede identificar la información esencial del pedido. |
| 2 | Mensaje parcialmente comprensible; requiere relectura o contiene redundancia que dificulta la comprensión. |
| 3 | Comprensible en general, con alguna imprecisión menor que no compromete el mensaje central. |
| 4 | Claro y directo; la información esencial se identifica sin esfuerzo. |
| 5 | Totalmente claro, conciso y sin ambigüedad; comunica exactamente lo necesario sin información sobrante. |

### 2. Adecuación del tono
Valora la pertinencia del registro lingüístico en relación con el contexto de la transacción.

| Nivel | Descriptor |
|---|---|
| 1 | Tono inadecuado para el contexto (ej. excesivamente informal ante una cancelación, o frío ante una entrega exitosa). |
| 2 | Parcialmente desajustado; genera una impresión distante o discordante con el estado del pedido. |
| 3 | Aceptable, sin errores graves, aunque genérico. |
| 4 | Apropiado y coherente con el estado del pedido y el registro conversacional esperado (uso de "vos", cordialidad). |
| 5 | Óptimo: cordial, natural y perfectamente ajustado a la situación específica del pedido. |

### 3. Relevancia contextual
Mide si el mensaje refleja los atributos específicos del pedido (producto, estado) en lugar de recurrir a formulaciones genéricas.

| Nivel | Descriptor |
|---|---|
| 1 | Mensaje genérico; no incorpora ningún dato específico del pedido. |
| 2 | Incorpora algún dato del pedido, pero de forma incorrecta o poco relevante. |
| 3 | Incorpora los datos básicos del pedido (estado) sin profundizar en detalles adicionales. |
| 4 | Incorpora varios atributos relevantes (producto, estado, canal) de forma coherente. |
| 5 | Completamente contextualizado: refleja con precisión los atributos específicos del pedido de forma natural, sin sonar a plantilla. |

### 4. Corrección lingüística
Evalúa la ausencia de errores gramaticales, ortográficos o de concordancia.

| Nivel | Descriptor |
|---|---|
| 1 | Múltiples errores graves que dificultan la comprensión (ortografía, concordancia, sintaxis). |
| 2 | Errores frecuentes que no impiden la comprensión pero resultan notorios. |
| 3 | Errores menores y aislados (tildes, algún error de concordancia). |
| 4 | Texto correcto, con como máximo un error menor no significativo. |
| 5 | Texto gramaticalmente impecable. |

## Nota sobre los saludos

Vas a notar que algunos mensajes empiezan con "¡Hola!" (genérico, sin nombre — los nombres reales fueron removidos antes de mostrarte los mensajes) y otros no tienen ningún saludo. Esa diferencia es esperable y no debería, por sí sola, hacerte sospechar el origen del mensaje — evaluala como un elemento más dentro del criterio de Tono, no como una pista a seguir.

## Cuando termines

Guardá el CSV con tus puntajes completos y devolvéselo a quien coordina el panel. No es necesario que veas los puntajes de los otros evaluadores ni el origen real de los mensajes — eso se usa después, en el análisis agregado.
