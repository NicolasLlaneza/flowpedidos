# Segunda ronda del panel — protocolo de ejecución

Cierra las tres limitaciones que la primera ronda dejó declaradas en §6.4 y §8.3:
panel corto (k=4), sin calibración previa, y corpus con origen y estado
parcialmente confundidos.

| | Ronda 1 | Ronda 2 |
|---|---|---|
| Evaluadores | 4 | 8 a 10 |
| Calibración previa | no | sí, dos ejemplos con puntaje de referencia |
| Corpus | 20 mensajes, proporcional por estado | 18 mensajes, cruzado por estado |
| Reparto por estado | 11 de 20 eran `paid` | cada estado en ambos brazos, misma proporción |
| Contraste | Mann-Whitney global | Mann-Whitney global **más** Wilcoxon pareado por estado |

## Por qué 18 mensajes y no 24

La plantilla estática produce **un texto fijo por estado**, así que el brazo de
control no puede tener dos mensajes distintos del mismo estado sin repetir texto
literal. Por eso el diseño es de 2 mensajes del modelo + 1 de plantilla por cada
uno de los 6 estados que invocan al modelo: 12 contra 6.

Lo que se balancea no es el tamaño de los brazos sino la **presencia de cada
estado en ambos**, con proporción constante 2:1 en todos. Eso es lo que
desconfunde origen y estado, que era el problema. Si se prefiere más potencia en
el contraste global, `--llm 3` da 24 mensajes (18 contra 6) manteniendo el
balanceo; el costo es pasar de 80 a 104 preguntas por evaluador, lo que suele
bajar la tasa de respuesta.

## Pasos

### 1. Corpus

```bash
cd scripts/panel
node build-corpus-balanceado.mjs          # o --llm 3
```

Produce `corpus_blind_v2.csv` (lo que se ve) y `corpus_key_v2.csv` (la clave,
**que no se comparte con nadie del panel**). Semilla fija en 42: reejecutarlo da
el mismo corpus.

Si aborta por mensajes insuficientes en algún estado, el problema está en la
corrida, no en el script: hace falta una corrida con más cobertura de ese estado
antes de armar el corpus.

### 2. Formulario

```bash
node generar-form-gs.mjs
```

Escribe `crear-form-panel-v2.gs` con los mensajes ya embebidos —no hay que
pegarlos a mano, que fue de donde salieron los problemas la vez pasada—. Después:

1. https://script.google.com → proyecto nuevo.
2. Pegar todo el archivo reemplazando `Código.gs`.
3. Guardar, elegir `crearFormulario` en el selector de funciones, Ejecutar.
4. Autorizar cuando lo pida (es el permiso para crear el formulario en la propia
   cuenta).
5. El enlace sale en **Ver → Registros**.

El formulario pide iniciar sesión con cuenta de Google y admite una sola
respuesta por persona: eso es lo que respalda la afirmación de que son
evaluadores distintos y externos.

### 3. Reclutamiento

Ocho a diez personas **externas al equipo de tesis**. Es el requisito que sostiene
el instrumento: un autor evaluando su propio artefacto invalida la medición.

No hace falta que sean especialistas —se evalúa calidad comunicacional percibida
por un destinatario, no corrección técnica—, pero conviene que no conozcan la
hipótesis del trabajo. Alcanza con decir que es una evaluación de mensajes de
notificación de pedidos.

Conviene mandar el enlace a doce o trece personas para terminar con diez
respuestas.

### 4. Análisis

Descargar las respuestas del formulario como CSV y:

```bash
python3 analyze_panel_v2.py respuestas.csv corpus_key_v2.csv
```

Reporta:

- **ICC(3,k) y alfa de Krippendorff** sobre el corpus, comparables con los de la
  primera ronda (0,533 y −0,110).
- **Efecto del anclaje**: dispersión entre evaluadores en los ítems de
  calibración contra la del corpus, y cuánto se apartó el panel de los puntajes
  de referencia. Es el control de si la calibración sirvió.
- **Desviación sistemática por evaluador**, que es lo que hundió el alfa la vez
  pasada: si vuelve a aparecer alguien a más de medio punto del panel, queda
  identificado.
- **Contraste global** (Mann-Whitney y delta de Cliff), comparable con la ronda 1.
- **Contraste pareado por estado** (Wilcoxon con p exacto), que el balanceo
  habilita: compara el modelo contra la plantilla *dentro de cada estado*, de
  modo que el estado deja de ser una explicación alternativa del resultado.

Sobre el Wilcoxon con 6 pares: el p más chico alcanzable a dos colas es 0,0312, y
solo se obtiene si los 6 estados van en la misma dirección. Es un test exigente y
de poca potencia, pero es el que corresponde al diseño pareado; por eso se
reporta junto al Mann-Whitney y no en su reemplazo.

### 5. Documento

Con los resultados en mano hay que actualizar §3.7 (diseño del corpus y
calibración), §5.4 (resultados), §6.4 y §8.3 (limitaciones, que en buena parte
dejan de aplicar) y regenerar el Anexo G con los nuevos puntajes por evaluador.

Hasta que la ronda no se ejecute, el documento describe la ronda de cuatro
evaluadores, que es la que efectivamente ocurrió. **No conviene adelantar en el
texto un diseño que todavía no se corrió**: si al final no se ejecuta, queda una
afirmación sin respaldo.

## Archivos

| Archivo | Qué es |
|---|---|
| `build-corpus-balanceado.mjs` | Arma el corpus cruzado desde la base |
| `generar-form-gs.mjs` | Genera el Apps Script con el corpus embebido |
| `crear-form-panel-v2.gs` | Generado; se pega en script.google.com |
| `CALIBRACION.md` | Los dos ejemplos, sus puntajes de referencia y el porqué |
| `analyze_panel_v2.py` | Análisis completo de las respuestas |
| `corpus_key_v2.csv` | Clave privada origen/estado — no compartir |
