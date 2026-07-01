# Contexto de desarrollo — FlowPedidos TFI

Archivo de continuidad entre sesiones. Refleja el estado real del proyecto al momento del último commit.

---

## Stack

- **n8n** (Docker, puerto 5678) — orquestador del pipeline
- **PostgreSQL 16** (Docker, puerto 5433 externo / 5432 interno) — base de datos `tfi`
- **mock-marketplace** (nginx, puerto 3001) — simula la API de Mercado Libre
- **Meta WhatsApp Business API** — despacho de notificaciones al cliente

---

## Pipeline completo (diagrama)

```
Webhook POST /ml-order
  → Validate webhook (Code)
  → IF valid?
      false → Audit validation_failed → Respond 400
      true  →
  → Enrich from mock (HTTP GET mock-marketplace/orders/{id})
  → Normalize ML order (Code)
  → Check idempotency (Postgres 01)
  → IF duplicate?
      true  → Audit duplicate → Respond 200
      false →
  → Upsert customer (Postgres 02)
  → Insert order (Postgres 03)
  → Split items
  → Insert items (Postgres 04)
  → Build LLM prompt (Code)
  → Call OpenAI (gpt-4o-mini)
  → Parse LLM response (Code)
  → IF use_fallback?
      true  → Fallback template (Code)
      false →
  → Insert ai_notification (Postgres 06)  ← RETURNING notification_id, order_id, message_text
  → Get customer phone (Postgres 07)
  → Merge dispatch ctx (Code)
  → Build WA payload (Code)
  → IF no_phone?
      true  → Audit no_phone → Update dispatch → Audit dispatch_failed
      false →
  → Send WhatsApp (HTTP POST Meta Cloud API, Continue On Fail: ON)
  → Parse WA response (Code)
  → Update dispatch (Postgres 08)
  → Audit dispatch (Postgres 05)
  → Respond 200
```

---

## Estado del workflow en n8n

**Sesión 2026-06-08** — construido hasta nodo 13.
**Sesión 2026-06-11** — construido hasta nodo 21:

| # | Nodo | Tipo | Estado |
|---|------|------|--------|
| 1 | `Webhook ML order` | Webhook | ✅ |
| 2 | `Validate webhook` | Code | ✅ |
| 3 | IF `Valid?` | IF | ✅ |
| 4 | `Audit validation_failed` | Postgres | ✅ |
| 5 | `Respond 400` | Respond to Webhook | ✅ |
| 6 | `Enrich from mock` | HTTP Request | ✅ |
| 7 | `Normalize ML order` | Code | ✅ |
| 8 | `Check idempotency` | Postgres | ✅ |
| 9 | IF `Duplicate?` | IF | ✅ |
| 10 | `Audit duplicate` | Postgres | ✅ |
| 11 | `Respond 200 duplicate` | Respond to Webhook | ✅ |
| 12 | `Upsert customer` | Postgres | ✅ |
| 13 | `Insert order` | Postgres | ✅ |
| 14 | `Split items` | Code | ✅ |
| 15 | `Insert items` | Postgres | ✅ |
| 16 | `Build LLM prompt` | Code | ✅ |
| 17 | `Call OpenAI` | OpenAI | ✅ |
| 18 | `Parse LLM response` | Code | ✅ |
| 19 | IF `Use fallback?` | IF | ✅ |
| 20 | `Fallback template` | Code | ✅ |
| 21 | `Insert ai_notification` | Postgres | ✅ |
| 22 | `Get customer phone` | Postgres | ⏳ |
| 23 | `Merge dispatch ctx` | Code | ⏳ |
| 24 | `Build WA payload` | Code | ⏳ |
| 25 | IF `Phone ok?` | IF | ⏳ |
| 26 | `Send WhatsApp` | HTTP Request | ⏳ |
| 27 | `Parse WA response` | Code | ⏳ |
| 28 | `Update dispatch` | Postgres | ⏳ |
| 29 | `Audit dispatch` | Postgres | ⏳ |
| 30 | `Respond 200` | Respond to Webhook | ⏳ |

---

## Archivos por nodo

### Code nodes
| Archivo | Nodo n8n | Mode |
|---------|----------|------|
| `n8n-workflows/lib/validate-webhook.js` | `Validate webhook` | Run Once for All Items |
| `n8n-workflows/lib/normalize-ml-order.js` | `Normalize ML order` | Run Once for All Items |
| `n8n-workflows/lib/validate-wc-webhook.js` | `Validate WC webhook` (rama WooCommerce) | Run Once for All Items |
| `n8n-workflows/lib/normalize-wc-order.js` | `Normalize WC order` (rama WooCommerce) | Run Once for All Items |
| `n8n-workflows/lib/build-llm-prompt.js` | `Build LLM prompt` | Run Once for Each Item |
| `n8n-workflows/lib/parse-llm-response.js` | `Parse LLM response` | Run Once for Each Item |
| `n8n-workflows/lib/fallback-template.js` | `Fallback template` | Run Once for Each Item |
| `n8n-workflows/lib/merge-dispatch-context.js` | `Merge dispatch ctx` | Run Once for Each Item |
| `n8n-workflows/lib/build-wa-payload.js` | `Build WA payload` | Run Once for Each Item |
| `n8n-workflows/lib/parse-wa-response.js` | `Parse WA response` | Run Once for Each Item |

### Postgres nodes (credencial `tfi_app`)
| Archivo | Nodo n8n |
|---------|----------|
| `n8n-workflows/sql/01_idempotency_check.sql` | `Check idempotency` |
| `n8n-workflows/sql/02_upsert_customer.sql` | `Upsert customer` |
| `n8n-workflows/sql/03_insert_order.sql` | `Insert order` |
| `n8n-workflows/sql/04_insert_items.sql` | `Insert items` |
| `n8n-workflows/sql/05_insert_audit.sql` | nodos de Audit |
| `n8n-workflows/sql/06_insert_ai_notification.sql` | `Insert ai_notification` |
| `n8n-workflows/sql/07_get_customer_phone.sql` | `Get customer phone` |
| `n8n-workflows/sql/08_update_dispatch.sql` | `Update dispatch` |

### Migración aplicada
| Archivo | Descripción |
|---------|-------------|
| `sql/03_wa_dispatch.sql` | Agrega `wa_message_id`, `message_status`, `error_message` a `ai_notifications` |

---

## Variables de entorno requeridas

Ver `.env.example`. Críticas para el despacho WA:
- `WHATSAPP_PHONE_NUMBER_ID` — ID numérico del número en Meta Business
- `WHATSAPP_ACCESS_TOKEN` — token permanente o temporal de Meta

---

## Notas de implementación

- **Nodo 14 (Split items)**: se implementó como Code node (no Item Lists) porque la versión gratuita de n8n no tiene "Split Out Items". El código referencia `$('Normalize ML order')`, `$('Upsert customer')` y `$('Insert order')` para armar un item por producto.
- **Nodo 17 (Call OpenAI)**: operación "Message a Model". Los mensajes se pasan como `{{ $json.messages[0].content }}` (system) y `{{ $json.messages[1].content }}` (user) directamente en las cajas de texto.

## Próxima sesión

Continuar desde nodo **22 — Get customer phone** y avanzar hasta el 30.
Cuando el workflow esté completo, exportarlo desde n8n y guardar como `n8n-workflows/workflow.json`.

### Rama WooCommerce (integración real, en curso)

Artefactos listos y testeados: `validate-wc-webhook.js` (firma HMAC + ping) y
`normalize-wc-order.js` (converge al mismo modelo canónico que ML). Ver
`n8n-workflows/README.md` → sección "Rama WooCommerce".

Pendiente de armar en la UI de n8n:
1. Nodo `Webhook WC order` (path `wc-order`, **Raw Body: ON**).
2. `Validate WC webhook` (Code) → `IF Valid?` → `Normalize WC order` (Code).
3. Cablear `Normalize WC order` al `Check idempotency` existente (converge con ML).
4. Setear `WC_WEBHOOK_SECRET` en `.env` y conectar el container de WordPress a la
   red `tfi-net` (delivery URL `http://tfi-n8n:5678/webhook/wc-order`).
5. Reexportar `workflow.json` cuando la rama quede andando.
