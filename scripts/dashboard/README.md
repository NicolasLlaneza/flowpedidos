# Tablero operativo del pipeline

Tablero de monitoreo sin dependencias ni build: un único HTML con SVG dibujado a
mano. Responde a la recomendación de monitoreo de la sección 8.1 del TFI y es la
Figura 8.1 del documento.

## Uso

```bash
cd scripts/dashboard

# Por defecto: desde la evidencia publicada de la corrida del Capítulo 5.
# No requiere base de datos, credenciales ni npm install.
node export-dashboard-data.mjs

# Desde la base, para monitorear una corrida en curso.
# Éste sí necesita el cliente de PostgreSQL:  cd .. && npm install
node export-dashboard-data.mjs --from-db
node export-dashboard-data.mjs --from-db --dataset   # sólo el dataset sintético
```

Después basta con abrir `index.html` haciendo doble clic: el exportador deja los
datos embebidos dentro del propio archivo, de modo que funciona con `file://`,
sin servidor y sin conexión.

Servirlo por HTTP es opcional. Si se lo sirve, el tablero prefiere
`dashboard-data.json`, que es el mismo contenido. Desde la raíz del repositorio:

```bash
python -m http.server 8090   # y abrir http://localhost:8090/scripts/dashboard/
```

La ruta importa: el comando se corre **en la raíz**, no en `scripts/dashboard`.
Servido desde esta carpeta, la dirección es `http://localhost:8090/` a secas.

## Las dos fuentes no son intercambiables

| | `--from-csv` (por defecto) | `--from-db` |
|---|---|---|
| Origen | `out/corrida-v2.csv` | `tfi.orders` + `tfi.ai_notifications` |
| Requiere base | no | sí |
| Reproducible por un tercero | **sí** | no |
| Cifras | las del Capítulo 5 | el estado actual |
| Indicador de anclaje | leído del agregado publicado, recalculable desde `out/anclaje-crudo-anon.csv` | **recalculado** |

La fuente por defecto es la evidencia publicada, y esa elección es deliberada:
cualquiera que clone el repositorio puede regenerar el tablero y obtener
exactamente las cifras que el documento reporta, sin levantar el stack. Las
cifras del Capítulo 5 se reconstruyen las siete: 148 pedidos persistidos, 143
con mensaje, 5 sin notificación, 1 degradación, USD 0,020929 de costo, y
medianas de extremo a extremo de 2.556 ms bajo despacho real y 1.092 ms bajo
despacho simulado.

El indicador de anclaje contextual se lee de `out/anclaje-resultado.txt`, la
salida de `scripts/analizar-anclaje.py` sobre los 142 mensajes que generó el
modelo en la corrida reportada, porque `out/corrida-v2.csv` no trae el texto de
los mensajes. La entrada del analizador también se publica, en
`out/anclaje-crudo-anon.csv`: es la salida de `sql/export-anclaje.sql` con el
saludo nominal reemplazado por `¡Hola [NOMBRE]!`. El reemplazo es necesario —en
la corrida reportada los 142 mensajes llevan el nombre y apellido del
destinatario, porque la base guarda el texto ya rehidratado— y no altera el
resultado: el analizador produce la misma salida sobre el archivo original y
sobre el anonimizado. Cualquiera puede recalcularlo con:

```bash
python scripts/analizar-anclaje.py out/anclaje-crudo-anon.csv
```

Como control de integridad, el exportador recalcula el intervalo de Wilson a
partir de los conteos que lee y lo contrasta con el que imprime el archivo. Si
difieren, avisa: significaría que el agregado y la corrida ya no son la misma.

## Qué muestra

**Confirmación al emisor.** La medición externa contra el umbral de 500 ms de la
plataforma de origen. No muestra el campo `ack_at` del esquema: la misma
sentencia de inserción asigna recepción y confirmación, de modo que su
diferencia es nula por construcción y no constituye una medición, según declara
la §5.2. Se informa mediana, rango y cantidad de observaciones, y se declara que
la medición es una cota inferior porque excluye el tramo del túnel público.

**Normalización al modelo canónico.** Las tasas que define el §3.3, cada una con
su intervalo de Wilson al 95 % y su denominador escrito, contra el umbral del
95 % que postula H2. La tasa condicional admite dos denominadores —contar sólo la
cabecera del pedido, o exigir además que sus ítems persistan— y el juicio sobre
H2 cambia según cuál se adopte: 100 % [97,5; 100] en el primer caso, 98,0 %
[94,2; 99,3] en el segundo, donde el intervalo contiene al umbral. El tablero
informa ambas en lugar de resolver la elección en silencio.

**Pedidos por estado canónico y canal**, con las dos plataformas de origen
segmentadas.

**Tiempo de extremo a extremo**, en un panel por modo de despacho. Los dos no
son comparables entre sí: uno viaja contra la API de mensajería y el otro no.

**Validador determinístico**, con el detalle de cada rechazo, intento por
intento, leído de `out/validador-rechazos.csv`. En la corrida reportada hubo uno,
WC-16, y el tablero lo presenta como lo que fue: un falso positivo de la regla
1, que comparaba por subcadena y encontró el «70» dentro de la medida 175/70,
seguido de un reintento que no llegó a ejecutarse (`fetch is not defined`).

**Anclaje contextual**, el segundo indicador de calidad del §3.3. Verifica
**presencia textual** del atributo en el mensaje, no la declaración del modelo,
y contrasta ambas barra contra barra: la regla 2 del validador acepta lo que el
modelo declara haber citado sin comprobarlo contra el texto, de modo que la
brecha entre lo declarado y lo presente es medible y se informa. Sobre la
corrida reportada esa brecha son 3 mensajes de 142.

El desglose deja ver dónde se ancla el modelo: `primary_product_name` en 139 de
142 mensajes, `items_count` en 14, y `total_amount` y `source_created_at` en
ninguno. Esos dos últimos no se dibujan como barras vacías —se declaran como
nunca declarados ni citados—, porque son un resultado y no un hueco del
gráfico. Se informa aparte que el modelo declara `order_status` en los 142, que
no constituye anclaje verificable: es el estado del pedido, no un atributo de
su contenido.

## Dos convenciones de lectura

**El ámbar significa una sola cosa: acá hay algo que mirar.** En la corrida
reportada lo cumple un solo indicador, los 5 pedidos sin notificación, que son
los únicos donde el cliente no recibió nada. Los 148 pedidos persistidos y los
143 mensajes generados van en verde aunque existan esos 5 y esa degradación:
son los resultados principales, y pintarlos de advertencia porque otro
indicador es distinto de cero hacía que la figura contradijera al documento. La
degradación a plantilla, en particular, no es una anomalía sino la degradación
elegante del §4.3.1 operando, y la tarjeta del validador ya describía ese mismo
hecho en verde.

**Los decimales van con coma**, como el documento. El costo se muestra con la
precisión que publica el Capítulo 5 —`USD 0,020929`, no una versión truncada—
para que cruzar la figura contra la Tabla 5.2 no exija explicar por qué los
dígitos no coinciden.

## Tres controles para cuando cambie la corrida

El tablero está pensado para sobrevivir a una corrida nueva sin producir una
figura equivocada en silencio. Ninguno de los tres se activa con la corrida
reportada; existen para el día que alguien regenere la evidencia.

**El indicador de anclaje no se publica si no corresponde a la corrida.** El
agregado y el CSV son dos archivos distintos: regenerar `corrida-v2.csv` sin
volver a correr `analizar-anclaje.py` daría indicadores nuevos con un anclaje
viejo. El exportador contrasta los mensajes que evaluó el analizador contra los
que generó el modelo en la corrida —los que llevan mensaje, menos los que
degradaron a plantilla— y ante cualquier discrepancia **no muestra el número**:
la tarjeta dice que está desactualizado y cómo regenerarlo. Publicarlo con una
salvedad al pie sería repetir el error por el que la figura llegó a mostrar
147/141/0.

**Ningún estado desaparece del gráfico.** Los siete estados del §3.2 estaban
fijos en el código y cualquier otro se descartaba en silencio, de modo que las
barras dejaban de sumar el total de pedidos sin que nada lo dijera. Ahora un
estado ajeno al modelo se grafica al final, marcado con `⚠`, y se explica debajo
de la tabla: puede ser un estado nuevo del modelo o un valor crudo de la
plataforma que el normalizador dejó pasar, y las dos cosas hay que mirarlas.

**Si falta el CSV, el mensaje se entiende.** Antes salía una traza de Node.

## Detalle por pedido

Cada agregado del tablero se abre para ver los pedidos que lo producen:
los indicadores del encabezado, las barras de estado y canal, los tramos del
histograma de latencia y las tasas de normalización. Se opera con el mouse o
con el teclado, y se cierra con `Escape`.

El objetivo no es operar sino **verificar**. Quien lee «1 degradación a
plantilla» puede ver cuál pedido fue, con qué regla y qué latencia tuvo, sin
abrir un CSV; quien lee que la tasa condicional cambia según el denominador
puede ver los tres pedidos que separan un criterio del otro. Los 148 pedidos
viajan embebidos en el propio HTML, de modo que el detalle funciona también
con `file://`.

Para operar —buscar por cliente, filtrar por texto, leer el mensaje enviado—
está el panel de `demo/`, que es otro artefacto con otro propósito.

> Si este comportamiento se conserva, la sección 8.1 del documento debe
> describirlo. Un tablero que hace más de lo que el documento dice vuelve a
> abrir la brecha entre documento y artefacto que este trabajo viene cerrando.

## Por qué el exportador reescribe `index.html`

El tablero lleva una copia de los datos embebida en un bloque
`<script id="fallback-data">`, para poder abrirse sin servidor. Esa copia es la
que termina en la figura del documento.

Mantenerla a mano produjo una divergencia real: la figura llegó a mostrar las
cifras de una corrida anterior —147 pedidos, 141 mensajes, 0 degradaciones—
mientras el Capítulo 5 reportaba otras. Por eso el exportador escribe el bloque
embebido desde el mismo objeto con el que genera el JSON. Regenerar el tablero y
recortar la figura de nuevo alcanza para que documento y artefacto vuelvan a
decir lo mismo, y para que no puedan volver a separarse.

Con `--from-db` no se embebe, porque ahí los datos son el estado momentáneo de
una corrida en curso y no la evidencia del documento. Se fuerza con `--embed` y
se evita con `--no-embed`.

> **Cuidado al monitorear.** `--from-db` deja `index.html` intacto pero sí
> sobreescribe `dashboard-data.json`, y servido por HTTP el tablero prefiere ese
> archivo. Después de monitorear una corrida, correr `node
> export-dashboard-data.mjs` sin argumentos devuelve el tablero a la evidencia
> del Capítulo 5. Mientras tanto la figura no engaña —el encabezado dice
> «fuente: tfi.orders + tfi.ai_notifications» y no «evidencia publicada»—, pero
> conviene regenerar antes de recortar la figura para el documento.
