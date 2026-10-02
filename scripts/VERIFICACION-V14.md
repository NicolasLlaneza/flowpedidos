# Corrida de verificación v1.4

Este procedimiento aplica las correcciones de la versión 1.4 del flujo y verifica que funcionen sobre el mismo dataset de la corrida v2 (semilla 42, 150 pedidos).

## Qué corrige

| # | Hallazgo | Cambio |
|---|---|---|
| C1 | NA-02: si OpenAI falla, el pedido queda sin notificación | Call OpenAI reintenta hasta 3 veces (con 2 s entre intentos). Si igual falla, la salida de error pasa por «LLM no disponible» hacia la plantilla. |
| C2 | NC-05: una falla en Insert Items corta la ejecución sin dejar rastro | Insert Items tiene ahora salida de error hacia «Audit items_failed» (`items_insert_failed` en `audit_log`). |
| C3 | NA-01: falso positivo de la regla 1 en WC-16 («70» dentro de «175/70») | Los identificadores se buscan como token aislado. |
| C4 | NC-03: la regla 2 no verificaba el anclaje | La regla 2 exige citar al menos un atributo del pedido y comprueba que cada atributo declarado aparezca en el texto. Usa los mismos criterios que `analizar-anclaje.py`. |
| C5 | NA-01: el reintento de WC-16 falló con «fetch is not defined» | El reintento usa `this.helpers.httpRequest`, el cliente HTTP de n8n. |
| C6 | NM-08: la plantilla ponía costo 0 aunque ya hubiera habido llamadas | La plantilla conserva los tokens, el costo y la latencia previos. |
| C7 | NA-06: no quedaba registrado el cuerpo enviado | La columna `dispatched_body` (migración 05) se completa en Update dispatch, con los parámetros pasados como arreglo. |
| C8 | NC-05: causa de la falla de Insert Items en los pedidos 145, 147 y 149 | Insert Items recibe los parámetros como arreglo (ver abajo). |

### La causa de NC-05

El nodo Postgres de n8n (typeVersion 2.5 o superior; el flujo usa 2.6) toma la lista de parámetros escrita como texto, evalúa cada `{{ }}` y, si el resultado no es JSON, lo parte por comas. Está en el código de `n8n-nodes-base`: `executeQuery.operation.js` y `stringToArray` en `helpers/utils.js`, revisados en la versión 2.15.1.

Los pedidos 145, 147 y 149 son los casos «título largo» de Mercado Libre. Sus títulos tienen tres comas, por ejemplo «…de uso, garantía extendida del fabricante, válida…». El nombre del producto se partía en varios valores y `$4` (quantity) recibía «garantía extendida del fabricante». De ahí el error de conversión numérica que el documento atribuyó a la cantidad.

El test lo reproduce con el fixture publicado. Falta confirmarlo en la corrida con V13, y si es posible también con el error guardado en n8n (paso 5, punto 1).

No está verificado por qué no fallaron los casos 146, 148 y 150 de WooCommerce. Lo más probable es que esos pedidos se creen en la tienda con sus propios productos, de nombre corto. V13 lo muestra.

La variable `TFI_FORZAR_RECHAZO` sirve solo para esta corrida. Rechaza a propósito el primer intento de los pedidos que liste, para poder observar el reintento. Vacía no hace nada.

## Archivos

- `scripts/aplicar-correcciones-v14.py`: aplica C1–C8 con anclas. Con `--check` solo verifica. Si alguna ancla no coincide, no escribe nada. Respeta el fin de línea de cada archivo.
- `scripts/test-validador.mjs`: 12 casos, sin red ni base. Corre el código del nodo tal como lo ejecuta n8n. Contra la versión v2 fallan 10 de los 11 casos del validador y la plantilla, lo que muestra que los casos detectan los defectos. El caso 12 reproduce la causa de NC-05 con el fixture del pedido 145.
- `sql/export-verificacion-v14.sql`: consultas V0–V13. Devuelve solo agregados y textos sin el saludo.

## Paso 1 · Aplicar y probar (en `D:\flowpedidos-limpio`)

Lo corre Claude desde la VM, o vos si tenés Python:

```
python scripts/aplicar-correcciones-v14.py --check
python scripts/aplicar-correcciones-v14.py
node scripts/test-validador.mjs          # esperado: "12 casos OK"
git diff --stat
```

## Paso 2 · Respaldo de la base v2 (antes de tocar nada)

```
docker exec tfi-postgres pg_dump -U n8n -d tfi -Fc -f /tmp/tfi-v2.dump
docker cp tfi-postgres:/tmp/tfi-v2.dump D:\respaldos\tfi-v2.dump
```

El respaldo tiene datos personales de la instalación de prueba. Queda fuera del repositorio y no se comparte. Si el usuario de Postgres de tu `.env` no es `n8n`, usá el que corresponda en este paso y en los siguientes.

## Paso 3 · Migración 05

```
Get-Content D:\flowpedidos-limpio\sql\05_dispatched_body.sql -Raw | docker exec -i tfi-postgres psql -U n8n -d tfi -v ON_ERROR_STOP=1
```

Debe terminar en `INSERT 0 1` (o `INSERT 0 0` si ya estaba aplicada: es idempotente).

## Paso 4 · Variables del contenedor n8n (en `D:\Tesis-TFI`, donde corre el stack)

1. En `D:\Tesis-TFI\docker-compose.yml`, dentro de `environment:` del servicio n8n y debajo de `OPENAI_API_KEY`, agregá la misma línea que el script sumó al compose del repo limpio:
   ```
         TFI_FORZAR_RECHAZO: ${TFI_FORZAR_RECHAZO:-}
   ```
2. En `D:\Tesis-TFI\.env`:
   ```
   WHATSAPP_MODE=simulate
   TFI_FORZAR_RECHAZO=
   ```
3. Recreá n8n y comprobá:
   ```
   cd D:\Tesis-TFI
   docker compose up -d --force-recreate n8n
   docker exec tfi-n8n printenv WHATSAPP_MODE
   ```

## Paso 5 · Reimportar el flujo

En n8n:

1. Opcional, como evidencia de NC-05: en «Executions» del flujo actual, abrí una ejecución con error del pedido 3000000000000145 (o 147 o 149). Copiá el mensaje de error del nodo Insert Items a `out/nc05-error-v2.txt`. No copies nada del panel de datos del cliente.
2. Desactivá el flujo actual. No lo borres: es la versión evaluada.
3. Creá un flujo nuevo e importá `D:\flowpedidos-limpio\n8n-workflows\workflow.json` desde «Import from File».
4. Revisá que los nodos Postgres tengan la credencial «Postgres account», incluido «Audit items_failed».
5. Revisá en el lienzo:
   - que Call OpenAI tenga dos salidas, y que la de error vaya a «LLM no disponible» y de ahí a «Fallback template»;
   - que Insert Items tenga una salida de error hacia «Audit items_failed».
6. Guardá y activá el flujo nuevo.

## Paso 6 · Prueba de falla: OpenAI no disponible

Con una clave inválida solo durante esta prueba. La variable de la sesión de PowerShell tiene prioridad sobre el `.env`, así que el `.env` no se toca:

```
cd D:\Tesis-TFI
$env:OPENAI_API_KEY = "sk-invalida"
docker compose up -d --force-recreate n8n
node scripts\run-corrida.mjs --reset --n 6 --wait 60
Get-Content D:\flowpedidos-limpio\sql\export-verificacion-v14.sql -Raw | docker exec -i tfi-postgres psql -U n8n -d tfi -A -F ";" -P footer=off > D:\flowpedidos-limpio\out\verificacion-v14-falla.txt
Remove-Item Env:OPENAI_API_KEY
docker compose up -d --force-recreate n8n
```

Resultado esperado en el archivo:

- V2 vacío: ningún pedido quedó sin notificación.
- V1: `plantillas` igual a `notificaciones`.
- V7: tantas filas como pedidos notificables.

Antes de esta versión, esos pedidos quedaban sin mensaje.

`--reset` vacía las tablas `tfi.*`. Por eso el paso 2 va primero.

## Paso 7 · Corrida completa con rechazos forzados

Poné en `D:\Tesis-TFI\.env` estos seis pedidos (3 de Mercado Libre y 3 de WooCommerce, en estado paid o shipped, sin casos borde):

```
TFI_FORZAR_RECHAZO=3000000000000021,3000000000000039,3000000000000057,3000000000000018,3000000000000038,3000000000000056
```

Después corré:

```
docker compose up -d --force-recreate n8n
docker exec tfi-n8n printenv TFI_FORZAR_RECHAZO
node scripts\run-corrida.mjs --reset --wait 120 --out D:\flowpedidos-limpio\out\corrida-v14.csv
Get-Content D:\flowpedidos-limpio\sql\export-verificacion-v14.sql -Raw | docker exec -i tfi-postgres psql -U n8n -d tfi -A -F ";" -P footer=off > D:\flowpedidos-limpio\out\verificacion-v14.txt
```

Qué mirar:

| Consulta | Esperado | Qué prueba |
|---|---|---|
| V0 | aparece `v1.4.0` | migración aplicada |
| V2 | vacío | ningún pedido sin notificación |
| V6 | 6 filas con `validator_passes = 2` | el reintento se ejecutó (C5). Si alguna terminó en plantilla, V12 dice por qué. |
| V12 | sin «fetch is not defined» ni «no hay cliente HTTP» | NA-01 resuelto |
| V9 | en `sent`, `con_cuerpo` igual a `n` | NA-06 resuelto |
| V11 | si aparece alguna fila, no es plantilla | WC-16 ya no se rechaza |
| V4 | reglas que rechazaron primeros intentos, además de `prueba_forzada` | efecto de C4 sobre la tasa de reintento |
| V13 | 145, 147 y 149 con 1 ítem; V10 sin `items_insert_failed` | NC-05 resuelto: persisten 148 de 148 |

Si en V6 faltan los tres de WooCommerce, el `external_id` canónico de ese canal no coincide con el del manifiesto. En ese caso, avisá y se ajusta la lista.

Costo estimado: unos 160 llamados a gpt-4o-mini, menos de USD 0,10.

## Paso 8 · Cierre

1. En `.env`, dejá `TFI_FORZAR_RECHAZO=` vacío y recreá n8n.
2. En `D:\flowpedidos-limpio`, agregá **solo** estos archivos:
   ```
   git add n8n-workflows/workflow.json n8n-workflows/lib/rehydrate-validate.js n8n-workflows/lib/fallback-template.js n8n-workflows/sql/08_update_dispatch.sql sql/05_dispatched_body.sql sql/export-verificacion-v14.sql docker-compose.yml scripts/aplicar-correcciones-v14.py scripts/test-validador.mjs scripts/VERIFICACION-V14.md out/verificacion-v14.txt out/verificacion-v14-falla.txt out/nc05-error-v2.txt
   git status
   ```
   Antes de hacer el commit, confirmá que no haya nada más en stage. `out/corrida-v14.csv` se revisa antes de sumarlo.
3. Pasame `verificacion-v14.txt` y `verificacion-v14-falla.txt`. Con eso se escribe §5.7 «Verificación de las correcciones» y se actualizan el Anexo B (migración 05) y las secciones que hoy declaran estos defectos como abiertos.

## Límites (van al documento tal cual)

- Es una corrida sobre el mismo dataset sintético. Verifica que los defectos se corrigieron, no reemplaza la evaluación v2 ni sus cifras.
- Los rechazos del paso 7 son inducidos: prueban el mecanismo de reintento, no la frecuencia natural de rechazo.
- La regla 2 nueva puede subir la tasa de reintento. V4 lo mide, y se informa aunque empeore el costo.
