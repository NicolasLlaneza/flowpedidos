# out/ — salidas publicadas

Resultados de las corridas instrumentadas. Se publican para que los valores que
el documento reporta puedan verificarse por reejecución sobre los datos
originales, y no solo leerse.

Los CSV efímeros de `scripts/run-corrida.mjs` están ignorados por `.gitignore`
(`out/corrida-*.csv`); lo que está acá se versionó de forma deliberada.

## Archivos

### `corrida-v2.csv`
Corrida reportada en el Capítulo 5, canal de WooCommerce, con despacho real
contra credenciales de producción de la API de WhatsApp Business Cloud. Una fila
por pedido. Es la fuente de la Tabla 5.1, la Tabla 5.2 y el Anexo H.

Columnas de tiempo en milisegundos: `interno_ms` es el componente de la
arquitectura propuesta, `dispatch_ms` el canal de despacho de un tercero, y
`e2e_ms` la suma. `ack_ms` vale cero por construcción: la sentencia de inserción
asigna el mismo sello de tiempo a `received_at` y a `ack_at`, de modo que no
constituye una medición — el contraste del criterio (a) de H1 se hace con
medición externa, según la sección 5.2.

`wamid_hash` reemplaza al identificador que devuelve la API de mensajería, que
incorpora el teléfono del destinatario codificado en base64. `destinatario`
seudonimiza los cuatro números verificados como D1 a D4.

### `corrida-v2-ml.csv`
Misma corrida, canal de Mercado Libre contra el simulador. Aporta la cobertura de
estados canónicos que el entorno de prueba de la plataforma real no permite
producir. Es la fuente de la sección 5.3 y de la Tabla 5.6.

### `corrida-2026-09-04-sintetica.csv`
Ejecución anterior, íntegramente sintética. No es la corrida reportada. Se
publica porque documenta el comportamiento de tres casos límite que la corrida
definitiva no llegó a disparar, según se declara en la sección 5.5.

### `muestra-live-2026-09-11.csv` y `muestra-live-2026-09-11-stats.md`
Muestra de despachos en vivo previa a la corrida definitiva, con sus
estadísticos agregados.

### `anclaje-resultado.txt` y `anclaje-crudo-anon.csv`
`anclaje-resultado.txt` es la salida de `scripts/analizar-anclaje.py` sobre los
142 mensajes que generó el modelo en la corrida reportada: indicador de anclaje
contextual de la sección 3.3 (139 de 142, 97,9 %) y su desglose por atributo.

`anclaje-crudo-anon.csv` es su entrada: la salida de `sql/export-anclaje.sql`
con el saludo nominal reemplazado por `¡Hola [NOMBRE]!`. La base guarda el texto
ya rehidratado, de modo que los 142 mensajes llevan el nombre y apellido del
destinatario; el archivo original (`anclaje-crudo.csv`) no se versiona por eso.
El reemplazo no altera el resultado: el analizador produce la misma salida sobre
ambos archivos. Para recalcular:

```bash
python scripts/analizar-anclaje.py out/anclaje-crudo-anon.csv
```

### `validador-rechazos.csv`
Detalle del único rechazo del validador en la corrida reportada (pedido WC-16),
copiado del campo `validator_failures` de `tfi.ai_notifications`: la regla 1
rechazó el primer intento por `contiene '70'` y el reintento falló con
`fetch is not defined`. Lo lee el tablero de `scripts/dashboard/`.

### `panel/`
Ver `scripts/panel/README.md`. Contiene las respuestas saneadas de la segunda
ronda del panel y las salidas del analizador.

## Verificación

Los estadísticos del panel se reproducen con:

```bash
python scripts/panel/analyze_panel_v2.py \
    out/panel/respuestas-ronda-2.csv \
    scripts/panel/corpus_key_v2.csv \
    --excluir=EX1
```

La salida debe coincidir con `out/panel/resultados-ronda-2.txt` y con los valores
de la sección 5.4 y del Anexo G del documento.
