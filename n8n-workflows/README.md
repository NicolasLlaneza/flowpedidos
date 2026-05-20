# Workflow n8n — Pipeline de procesamiento

Esta carpeta contiene los **artefactos que viven dentro de los nodos** del workflow, no el workflow exportado en sí. Cada archivo está pensado para copiarse y pegarse en el nodo correspondiente de la UI de n8n.

Cuando el workflow esté funcionando, exportarlo a `workflow.json` y guardarlo acá también.

## Arquitectura del flujo (Fase 3)

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
                         [Code: build prompt v1 con pseudonym]
                                ↓
                         [OpenAI: chat completion]
                                ↓
                         [Code: parse JSON + validar respuesta]
                                ↓
                            válida?
                            /     \
                           no      sí
                           ↓       ↓
                    [usar plantilla] [usar mensaje LLM]
                           ↓       ↓
                         [Postgres: 06_insert_ai_notification.sql]
                                ↓
                         [Audit: persisted_ok]
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

### Nodos HTTP/LLM
| Nodo en n8n | Config |
|---|---|
| `Enrich from mock`     | GET `http://mock-marketplace/orders/{{ $json.order_id }}` |
| `Call OpenAI`          | OpenAI node → Model: `gpt-4o-mini` → params del `prompts/v1.md` |

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
