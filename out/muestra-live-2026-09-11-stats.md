# Muestra live N=16 · Descomposición del e2e — Corrida 2026-09-11

> **Alcance de este documento.** Es la primera evidencia end-to-end del canal de
> WooCommerce en modo de despacho real, anterior a la corrida definitiva del
> 2026-09-15. Para las cifras de latencia que el Capítulo 5 reporta, esta muestra
> quedó **superada** por `out/corrida-v2.csv` (n=148, 75 despachos reales): los
> valores de abajo corresponden a otra ejecución, con otra ventana temporal de la
> API del modelo de lenguaje, y no son los que el documento informa. Se conserva
> como registro de procedencia del canal en modo real y se cita desde la sección
> 3.11 con ese único propósito.

**Contexto:** 16 pedidos reales de la instalación de prueba de WooCommerce,
`WHATSAPP_MODE=live` contra credenciales de producción de la API de WhatsApp
Business Cloud. Cuatro destinatarios verificados, con ventana de 24 horas
abierta, identificados aquí por los seudónimos D1 a D4 con el mismo criterio de
seudonimización que el esquema aplica a los clientes. Demora de 15 segundos
entre disparos.

**Origen:** `out/muestra-live-2026-09-11.csv` — instrumentado sobre
`tfi.orders` ⋈ `tfi.ai_notifications`. La columna `wamid` se publica como
`wamid_hash` (sha256 truncado a 16 hexadecimales) porque el identificador que
devuelve la API lleva el teléfono del destinatario embebido en su estructura;
el saneamiento se aplica con `scripts/sanitize-wamid.py` y su motivo se detalla
en el encabezado de ese script.

## Resultado

**16 de 16 con identificador de mensaje real de Meta**, todos con
`message_status = 'sent'` y `validator_passes = 1`. Ninguno degradó a plantilla
estática.

## Descomposición del tiempo de extremo a extremo

El punto de corte es el sello `generated_at` de `ai_notifications`, que se
registra al insertar la fila, posterior al validador y previo al nodo de envío.

| Componente | min | media | p50 | p95 | máx |
|---|---|---|---|---|---|
| **Interno** — `received_at → generated_at` (modelo + validador + persistencia) | 1151 | 1718 | 1670 | 3006 | 3032 |
| **Externo** — `generated_at → dispatched_at` (ida y vuelta contra la Cloud API) | 881 | 1480 | 1448 | 2009 | 2270 |
| **Extremo a extremo** — `received_at → dispatched_at` | 2498 | 3198 | 2952 | 4821 | 5303 |

Todos los valores en milisegundos. Cada celda es la mediana o el percentil de su
propia distribución, calculada sobre las observaciones individuales: en cada
pedido los componentes suman de forma exacta el compuesto, pero los percentiles
de distribuciones distintas no tienen por qué sumar entre sí, de modo que las
filas no son aditivas.

## Distribución por estado canónico

`paid` (10), `delivered` (3), `pending_payment` (1), `cancelled` (1),
`refunded` (1). Cinco de los seis estados canónicos; falta `shipped`, que una
instalación de WooCommerce sin extensiones no produce —el estado `processing` de
la plataforma normaliza a `paid`— y que requeriría un complemento de seguimiento
de envíos. Es una restricción de la plataforma de origen y no de la arquitectura.

## Distribución por destinatario

Cuatro pedidos por destinatario, sin excepciones. El reparto uniforme es la
evidencia de que el flujo resuelve el destinatario a partir del dato del pedido
y no de una constante: si lo tomara de una constante, los dieciséis mensajes
habrían ido a un único número.

| Destinatario | Pedidos |
|---|---|
| D1 | 4 |
| D2 | 4 |
| D3 | 4 |
| D4 | 4 |

El mapeo entre seudónimo y número de teléfono no se versiona, conforme al
criterio de minimización de datos declarado en las secciones 2.7 y 3.12 del
documento.

## Costo

Aproximadamente USD 0,00015 por pedido con `gpt-4o-mini`, en línea con la
corrida definitiva.
