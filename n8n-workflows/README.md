# Workflow n8n — Pipeline de procesamiento

Esta carpeta contiene los **artefactos que viven dentro de los nodos** del workflow, no el workflow exportado en sí. Cada archivo está pensado para copiarse y pegarse en el nodo correspondiente de la UI de n8n.

Cuando el workflow esté funcionando, exportarlo a `workflow.json` y guardarlo acá también.

## Arquitectura del flujo (Fase 3 + despacho WhatsApp)

```
[Webhook trigger: POST /webhook/ml-order]
            ↓
[Code: validate-webhook.js]
            ↓
        valid?
       /        \
      no         sí
      ↓           ↓
[Audit:        [HTTP Request:
 validation_     GET mock-marketplace/orders/{order_id}]
 failed]                  ↓
      ↓           [Code: normalize-ml-order.js]
[Respond 400]             ↓
              [Postgres: 01_idempotency_check.sql]
                          ↓
                    duplicate?
                    /        \
                   sí         no
                   ↓           ↓
            [Audit:      [Postgres: 02_upsert_customer.sql]
             duplicate_         ↓
             detected]   [Postgres: 03_insert_order.sql]
                   ↓           ↓
            [Respond 200] [Split In Batches → items]
                                ↓
                         [Postgres: 04_insert_items.sql]
                                ↓
                         [Code: build-llm-prompt.js]
                                ↓
                         [OpenAI: chat completion]
                                ↓
                         [Code: parse-llm-response.js]
                                ↓
                            válida?
                            /     \
                           no      sí
                           ↓       ↓
                    [fallback-template.js]
                           ↓       ↓
                         [Postgres: 06_insert_ai_notification.sql]
                                ↓
                    ── DESPACHO WHATSAPP ──────────────────
                                ↓
                         [Postgres: 07_get_customer_phone.sql]
                                ↓
                         [Code: build-wa-payload.js]
                                ↓
                           phone ok?
                           /       \
                          no        sí
                          ↓         ↓
                   [Audit:   [HTTP Request: Meta Cloud API
                    no_phone  POST /{PHONE_NUMBER_ID}/messages]
                    → failed]          ↓
                          ↓      Meta ok?
                          ↓      /       \
                          ↓    sí         no
                          ↓    ↓           ↓
                          ↓  status=sent  status=failed
                          ↓    ↓           ↓
                         [Postgres: 08_update_dispatch.sql]
                                ↓
                         [Audit: dispatch_ok / dispatch_failed]
                                ↓
                         [Respond 200]
```

## Mapeo nodos ↔ artefactos

### Nodos de Code (JavaScript)
| Nodo en n8n | Archivo | Modo |
|---|---|---|
| `Validate webhook`     | `lib/validate-webhook.js`     | Run Once for All Items |
| `Normalize ML order`   | `lib/normalize-ml-order.js`   | Run Once for All Items |
| `Build LLM prompt`     | `lib/build-llm-prompt.js`     | Run Once for Each Item |
| `Parse LLM response`   | `lib/parse-llm-response.js`   | Run Once for Each Item |
| `Fallback template`    | `lib/fallback-template.js`    | Run Once for Each Item |
| `Build WA payload`     | `lib/build-wa-payload.js`     | Run Once for Each Item |
| `Merge dispatch ctx`   | `lib/merge-dispatch-context.js` | Run Once for Each Item |
| `Parse WA response`    | `lib/parse-wa-response.js`    | Run Once for Each Item |

### Nodos de Postgres
Credencial a usar: **`tfi_app`** (no el superuser n8n).
Configurar una vez en Settings → Credentials → New → Postgres:
- Host: `postgres`
- Database: `tfi`
- User: `tfi_app`
- Password: el valor de `TFI_APP_PASSWORD` del `.env`
- Port: `5432`
- SSL: disable (red interna)

| Nodo en n8n | Archivo | Operation |
|---|---|---|
| `Check idempotency`     | `sql/01_idempotency_check.sql`     | Execute Query |
| `Upsert customer`       | `sql/02_upsert_customer.sql`       | Execute Query |
| `Insert order`          | `sql/03_insert_order.sql`          | Execute Query |
| `Insert items`          | `sql/04_insert_items.sql`          | Execute Query |
| `Audit ...`             | `sql/05_insert_audit.sql`          | Execute Query |
| `Insert ai_notification`| `sql/06_insert_ai_notification.sql`| Execute Query |
| `Get customer phone`    | `sql/07_get_customer_phone.sql`    | Execute Query |
| `Update dispatch`       | `sql/08_update_dispatch.sql`       | Execute Query |

> **Nota sobre nombres de nodos**: `merge-dispatch-context.js` referencia al nodo Postgres por el nombre exacto `"Insert ai_notification"`. Si le ponés otro nombre en n8n, actualizá la línea `$('Insert ai_notification')` en ese archivo.

### Nodos HTTP/LLM
| Nodo en n8n | Config |
|---|---|
| `Enrich from mock`     | GET `http://mock-marketplace/orders/{{ $json.order_id }}` |
| `Call OpenAI`          | OpenAI node → Model: `gpt-4o-mini` → params del `prompts/v1.md` |
| `Send WhatsApp`        | Ver sección "Configuración nodo Meta API" más abajo |

### Configuración nodo Meta API (`Send WhatsApp`)

Tipo: **HTTP Request**

| Campo | Valor |
|---|---|
| Method | POST |
| URL | `https://graph.facebook.com/v20.0/{{ $env.WHATSAPP_PHONE_NUMBER_ID }}/messages` |
| Authentication | Generic Credential Type → Header Auth |
| Header name | `Authorization` |
| Header value | `Bearer {{ $env.WHATSAPP_ACCESS_TOKEN }}` |
| Body Content Type | JSON |
| Body | `{{ JSON.stringify($json.meta_body) }}` |
| Response | Include response headers: No |

Variables de entorno a agregar en `.env`:
```
WHATSAPP_PHONE_NUMBER_ID=  # ID numérico del número de teléfono en Meta Business
WHATSAPP_ACCESS_TOKEN=     # Token permanente o temporal (System User o Test token)
```

Respuesta exitosa de Meta (200):
```json
{
  "messaging_product": "whatsapp",
  "contacts": [{ "input": "+549...", "wa_id": "549..." }],
  "messages": [{ "id": "wamid.HBgN..." }]
}
```
→ Extraer `wa_message_id` con: `{{ $json.messages?.[0]?.id ?? null }}`

## Rama WooCommerce (multicanal real)

Suma WooCommerce como **canal real** junto al de Mercado Libre. No reemplaza el
flujo de ML: es una rama nueva con su propio webhook y adaptador que **converge**
en el mismo tronco (idempotencia → persistencia → LLM → WhatsApp → auditoría).

```
[Webhook trigger: POST /webhook/wc-order]   ← Raw Body: ON
            ↓
[Code: validate-wc-webhook.js]  ← valida firma HMAC-SHA256, detecta ping
            ↓
         valid?
        /       \
       no        sí
       ↓          ↓
[Respond 200]  [Code: normalize-wc-order.js]   ← SIN enrich (WC manda el pedido completo)
 (o 401 si                 ↓
  firma inválida)  [Postgres: 01_idempotency_check.sql]
                           ↓
                   ── converge con el tronco compartido ──
```

Diferencia central con ML: **no hay paso de enrich**. WooCommerce envía el pedido
completo en el body del webhook, así que se pasa directo del validador al
normalizador. A partir del check de idempotencia, los nodos son los mismos que
usa ML (`02`…`08`, LLM, fallback, WhatsApp, audit).

### Nodos de la rama

| Nodo en n8n | Archivo | Modo / Config |
|---|---|---|
| `Webhook WC order`      | —                              | HTTP Method POST, Path `wc-order`, **Options → Raw Body: ON** |
| `Validate WC webhook`   | `lib/validate-wc-webhook.js`   | Code, Run Once for All Items |
| `IF Valid?`             | —                              | `{{ $json.valid }}` is true |
| `Normalize WC order`    | `lib/normalize-wc-order.js`    | Code, Run Once for All Items |

Desde `Normalize WC order` en adelante se reutilizan los nodos existentes
(`Check idempotency` → … → `Respond 200`).

### Por qué "Raw Body: ON"

WooCommerce firma los **bytes exactos** del body (HMAC-SHA256 en base64, header
`x-wc-webhook-signature`). Si n8n re-serializa el JSON, el orden de claves o los
escapes unicode pueden cambiar y la firma no coincide. Con *Raw Body* activado, el
validador usa el body crudo y la firma valida siempre. Sin eso, cae a
`JSON.stringify(body)` (best-effort) y lo avisa en `applied_rules` — sirve en dev,
no confíes en prod.

### Mapeo de estados WooCommerce → canónico

| WooCommerce | Canónico | Nota |
|---|---|---|
| `checkout-draft`     | `created` | |
| `pending` / `on-hold`| `pending_payment` | esperando pago (p.ej. transferencia) |
| `processing`         | `paid` | pago recibido, en preparación |
| `completed`          | `delivered` | WC lo da por finalizado |
| `cancelled`          | `cancelled` | |
| `refunded`           | `refunded` | |
| `failed`             | `error` | pago fallido |

WooCommerce no tiene estados de envío nativos (shipped/delivered vienen de plugins
de tracking); el `delivery_status` de cada item se deriva del estado del pedido.

### Setup en WooCommerce (WordPress admin)

1. **WooCommerce → Settings → Advanced → Webhooks → Add webhook**
   - **Topic**: `Order created` (agregar otro para `Order updated` si querés
     notificar cambios de estado)
   - **Delivery URL**: URL del webhook de n8n (ver conectividad abajo)
   - **Secret**: un valor fuerte → copiarlo a `WC_WEBHOOK_SECRET` en `.env`
   - **Status**: Active
2. Al guardar, WooCommerce manda un **ping** de activación; el validador lo detecta
   (`is_ping: true`) y no lo procesa como pedido.
3. Probar: crear un pedido en la tienda (o cambiarle el estado) → dispara el webhook.

### Levantar la tienda con Docker (recomendado)

El repo incluye `docker-compose.woocommerce.yml` que levanta WordPress + MariaDB en
la **misma red** que n8n (`tfi-net`), así el webhook viaja por la red interna sin
exponer nada a internet.

```bash
# Requiere el stack principal levantado (crea la red tfi-net):
docker compose up -d

# Levantar la tienda (WordPress en http://localhost:8080):
docker compose -f docker-compose.woocommerce.yml up -d
```

Setup inicial (primera vez, ~10 min):

1. Abrí `http://localhost:8080` → completá el wizard de WordPress (título, usuario
   admin, contraseña).
2. **Plugins → Add New** → instalá y activá **WooCommerce** → corré su setup wizard.
3. **Products → Add New** → creá 1-3 productos con precio y SKU.
4. Configurá el webhook (**WooCommerce → Settings → Advanced → Webhooks**):
   - **Topic**: `Order created`
   - **Delivery URL**: `http://tfi-n8n:5678/webhook/wc-order`
   - **Secret**: el mismo valor que pusiste en `WC_WEBHOOK_SECRET` del `.env`
   - **Status**: Active

> Si preferís usar una instalación de WordPress que ya tenés en otro compose,
> conectá su container a la red del stack:
> `docker network connect tfi-net <nombre-container-wordpress>` y usá la misma
> Delivery URL (`http://tfi-n8n:5678/webhook/wc-order`).

> **Error "URL de entrega no válida" al guardar el webhook**: WordPress bloquea
> por seguridad las peticiones a IPs privadas (`wp_http_validate_url`), y el
> container de n8n vive en la red interna (172.x). El repo incluye un *must-use
> plugin* (`wordpress/mu-plugins/flowpedidos-allow-internal-webhook.php`) que
> habilita el host `tfi-n8n`; el compose ya lo monta. Si usás tu propio WordPress,
> copiá ese archivo a `wp-content/mu-plugins/` (se carga solo, sin activar) y
> volvé a guardar el webhook.

### Simular la compra desde la tienda

Con el workflow **activo** en n8n:

1. Entrá a la tienda (`http://localhost:8080/shop` o la home).
2. Agregá un producto al carrito → **Checkout** → completá datos de facturación
   (nombre, email, teléfono) → hacé el pedido con un método offline (p.ej.
   "Transferencia bancaria directa" / *Cash on delivery*, que WooCommerce trae).
3. Al confirmarse, WooCommerce dispara el webhook `order.created` → n8n recibe,
   valida la firma, normaliza y persiste el pedido.

Verificar que entró:

```bash
docker compose exec postgres psql -U postgres -d tfi -c \
  "SELECT external_id, channel, status, total_amount FROM tfi.orders WHERE channel='woocommerce' ORDER BY received_at DESC LIMIT 5;"
```

> Para "escuchar" el evento de prueba desde la UI de n8n, el path es
> `/webhook-test/wc-order` mientras el workflow está en modo *Listen for test event*.
> Una vez activado el workflow, queda en `/webhook/wc-order`.
>
> El estado del pedido recién creado suele ser `pending`/`on-hold` (→ canónico
> `pending_payment`); si marcás el pedido como *Processing* o *Completed* en el
> admin y tenés un webhook `Order updated`, se dispara de nuevo con el estado
> actualizado.

### Probar el normalizador sin webhook

Hay un fixture de pedido WooCommerce realista en
`mocks/webhooks/wc-order-processing.json` (2 productos, guest→customer con id, estado
`processing`). Podés pegarlo como pinned data en el nodo Webhook o alimentarlo
directo al normalizador para validar el mapeo canónico.

## Convenciones para el workflow

1. **Naming de nodos**: usar prefijo de etapa (`webhook`, `enrich`, `normalize`, `persist`, `llm`, `audit`) seguido de la acción.
2. **Webhook path**: `/webhook/ml-order` (con barra inicial). Para test usar `/webhook-test/ml-order` que es el modo "Listen for test event" de n8n.
3. **Manejo de errores**: cada rama de error termina en un nodo de audit + respond. No dejar errores sin loguear.
4. **Configuración general del workflow**: Settings → Save data of execution → siempre, para que `audit_log` quede sincronizado con las ejecuciones de n8n.

## Detalles de los Code nodes LLM

### `build-llm-prompt.js`
**Punto crítico de seudonimización**: este archivo es el único lugar donde se decide qué información llega al servicio externo. Tiene un guard interno (`pii_keys`) que lanza error si detecta nombres de campo de PII en el contexto generado. Cualquier nuevo campo que se agregue al contexto debe revisarse contra esta lista.

### `parse-llm-response.js`
- Soporta respuestas tanto de OpenAI como de Anthropic (estructuras nativas)
- Calcula `cost_usd` con pricing por modelo (constante `PRICING` — actualizable)
- Aplica validaciones: JSON válido, shape correcta, longitud razonable, `confidence ≥ 0.3`
- Si todo OK → camino feliz, ruta a INSERT de ai_notification
- Si algo falla → marca `use_fallback=true` y un IF node siguiente rutea a `fallback-template.js`
- Aún en fallback **se cobra** lo gastado en tokens — queda registrado en el `audit_log`

### `fallback-template.js`
- Plantillas estáticas por estado (los 9 estados del CHECK constraint de orders)
- Output con la misma shape que el path feliz, así el INSERT a `ai_notifications` es uniforme
- Genera `audit_event` con `event_type='fallback_triggered'`

## Para Fase 4 (resiliencia)

Cuando agreguemos manejo de errores y reintentos:
- Configurar `Retry On Fail` en los nodos críticos (HTTP, OpenAI)
- Implementar backoff exponencial vía un Wait node con expresión
- Agregar `Error Trigger` workflow paralelo para fallas no recuperables
- La rama de fallback ya está prevista en `parse-llm-response.js` + `fallback-template.js`

## Para Fase 6 (comparación de modelos)

La estructura del `ai_notifications` ya soporta multi-proveedor. Para correr el experimento comparativo:
- Clonar el workflow → cambiar el nodo OpenAI por Anthropic
- Mismo dataset, mismo prompt v1
- Query SQL final compara `provider` + métricas
