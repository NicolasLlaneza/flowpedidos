# Contexto de desarrollo — FlowPedidos TFI

Archivo de continuidad entre sesiones. Refleja el estado real del proyecto al momento del último commit.

**Última actualización:** 2026-07-02 — pipeline end-to-end multicanal (ML + WooCommerce) con WhatsApp real validado.

---

## Stack

- **n8n** (Docker, puerto 5678) — orquestador del pipeline
- **PostgreSQL 16** (Docker, puerto 5433 externo / 5432 interno) — base de datos `tfi`
- **mock-marketplace** (nginx, puerto 3001) — simula la API de Mercado Libre
- **WordPress + WooCommerce** (Docker, puerto 8080) — canal WC real sobre MySQL 8
- **MySQL 8.0** (Docker, red interna) — DB de WordPress
- **Meta WhatsApp Business API** — despacho de notificaciones al cliente (Cloud API, número de prueba verificado)
- **OpenAI GPT-4o-mini** — generación de mensajes transaccionales
- Todo levantado con `docker compose up -d` — red interna `tfi-net` conecta n8n ↔ WC ↔ Postgres sin exponer nada a internet

---

## Pipeline completo (multicanal)

Dos entrypoints, un pipeline canónico:

```
Webhook POST /ml-order ─┐
                        ├─► Validate webhook ─► Enrich from mock ─► Normalize ML order ─┐
Webhook POST /wc-order ─┘                                                                ├─► Route to canonical (bridge)
                              └─► Validate webhook ─► Normalize WC order ────────────────┘         │
                                                                                                   ▼
                                       Check idempotency ─► IF duplicate? ─► (audit + respond 200)
                                                                │
                                                                ▼
                                       Upsert customer ─► Insert order ─► Split items ─► Insert items
                                                                │
                                                                ▼
                                       Build LLM prompt ─► Call OpenAI ─► Parse LLM ─► IF use_fallback? ─► Fallback template
                                                                │
                                                                ▼
                                       Insert ai_notification ─► Get customer phone ─► Merge dispatch ctx ─► Build WA payload
                                                                │
                                                                ▼
                                       IF phone_ok? ─► Send WhatsApp (Meta Cloud) ─► Parse WA ─► Update dispatch ─► Audit ─► Respond 200
```

**Patrón clave:** el nodo `Route to canonical` (Code, `return $input.all()`) actúa de puente entre los normalizadores canal-específicos y el resto del pipeline. Downstream referencia `$('Route to canonical').item.json.customer.xxx` — así, agregar un canal nuevo solo requiere `Webhook + Validate + Normalize` que desemboque en el bridge.

---

## Estado del workflow en n8n

**Sesiones anteriores:**
- 2026-06-08 — nodos 1–13
- 2026-06-11 — nodos 14–21

**Sesión 2026-06-25** — workflow ML completo (nodos 22–30), WhatsApp real entregado al teléfono del usuario. Meta cred configurada.

**Sesión 2026-06-29** — multicanal WooCommerce:
- Agregado `Webhook wc-order`, `Validate webhook wc`, `Normalize WC order` (nuevo Code node).
- Insertado `Route to canonical` como bridge; ambos normalizadores convergen ahí.
- WordPress + MySQL levantados en `docker-compose.yml`; webhook WC → n8n por red interna.

**Sesión 2026-07-02** — validación end-to-end con dos números reales:
- Truncate DB → POST WC-shape → 22 nodos ejecutados sin error → WhatsApp entregado a +542613678080 y +542615915390.
- Correcciones aplicadas: `docker compose restart` NO reinyecta env vars (usar `--force-recreate`); credencial "Header Auth account" en n8n guarda su copia encriptada del token (no lee `$env`), hay que actualizarla en la UI cuando rota el Meta token.

**Total del workflow:** 30+ nodos, ambos caminos (ML/WC) verificados con `execution_entity.status = success`.

---

## Archivos por nodo

### Code nodes
| Archivo | Nodo n8n | Mode |
|---------|----------|------|
| `n8n-workflows/lib/validate-webhook.js` | `Validate webhook` (ML y WC) | Run Once for All Items |
| `n8n-workflows/lib/normalize-ml-order.js` | `Normalize ML order` | Run Once for All Items |
| `n8n-workflows/lib/normalize-wc-order.js` | `Normalize WC order` | Run Once for All Items |
| (inline `return $input.all()`) | `Route to canonical` | Run Once for All Items |
| `n8n-workflows/lib/build-llm-prompt.js` | `Build LLM prompt` | Run Once for Each Item |
| `n8n-workflows/lib/parse-llm-response.js` | `Parse LLM response` | Run Once for Each Item |
| `n8n-workflows/lib/fallback-template.js` | `Fallback template` | Run Once for Each Item |
| `n8n-workflows/lib/merge-dispatch-context.js` | `Merge dispatch ctx` | Run Once for Each Item |
| `n8n-workflows/lib/build-wa-payload.js` | `Build WA payload` | Run Once for Each Item |
| `n8n-workflows/lib/parse-wa-response.js` | `Parse WA response` | Run Once for Each Item |

### Postgres nodes (credencial `tfi_app`)
| Archivo | Nodo n8n |
|---------|----------|
| `n8n-workflows/sql/01_idempotency_check.sql` | `Check idempotency` — LEFT JOIN dummy: siempre 1 fila con `already_exists` bool |
| `n8n-workflows/sql/02_upsert_customer.sql` | `Upsert customer` |
| `n8n-workflows/sql/03_insert_order.sql` | `Insert order` |
| `n8n-workflows/sql/04_insert_items.sql` | `Insert items` |
| `n8n-workflows/sql/05_insert_audit.sql` | nodos de Audit (con `NULLIF($N::text,'null')` para tolerar stringificación de n8n) |
| `n8n-workflows/sql/06_insert_ai_notification.sql` | `Insert ai_notification` |
| `n8n-workflows/sql/07_get_customer_phone.sql` | `Get customer phone` |
| `n8n-workflows/sql/08_update_dispatch.sql` | `Update dispatch` |

### Migraciones aplicadas
| Archivo | Descripción |
|---------|-------------|
| `sql/03_wa_dispatch.sql` | `wa_message_id`, `message_status`, `error_message` en `ai_notifications` |

---

## Variables de entorno críticas

Ver `.env.example`. Al despacho WA:
- `WHATSAPP_PHONE_NUMBER_ID` — ID numérico del número en Meta Business
- `WHATSAPP_ACCESS_TOKEN` — token de Meta (temporales duran 24h; rotarlos requiere actualizar `.env` **y** la credencial "Header Auth account" en n8n UI)
- `WC_WEBHOOK_SECRET` — HMAC del webhook WC configurado en WordPress

Al Docker Compose:
- `NODE_FUNCTION_ALLOW_BUILTIN=crypto` — permite `require('crypto')` en Code nodes
- `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` — permite `$env.*` en Code nodes

---

## Notas de implementación / gotchas

- **`docker compose restart` no reinyecta env vars.** Cambiar `.env` requiere `docker compose up -d --force-recreate n8n`.
- **Credencial "Header Auth account" en n8n** guarda el token encriptado en la DB — no lee `$env` salvo que la definas como expresión con `=Bearer {{ $env.WHATSAPP_ACCESS_TOKEN }}` (la UI a veces rechaza esta expresión en `httpHeaderAuth`; fallback: pegar `Bearer <token literal>` y reactualizarla cuando rote).
- **Node reference en flujo multi-source:** downstream NO puede referenciar `$('Normalize ML order')` directamente porque cuando entra por WC ese nodo no se ejecutó → throw. Solución: el bridge `Route to canonical` y downstream referencia el bridge.
- **`workflow_entity` vs `workflow_history`:** n8n separa draft (working copy) del snapshot activo (`workflow_history` donde `versionId = activeVersionId`). Editar directamente en DB requiere tocar ambos.
- **PostgreSQL + n8n:** n8n stringifica `null` JS → texto `"null"` en parámetros SQL. Envolver con `NULLIF($N::text, 'null')::<type>`.
- **Meta phone format AR:** el número del user está registrado en Meta sin el "9" (`+542613075850`, no `+5492613075850`). El normalizador NO agrega "9".
- **WC async dispatch:** los webhooks de WC se encolan vía Action Scheduler; wp-cron no procesa sincrónicamente. Para tests, POSTear el payload manualmente al webhook de n8n.
- **Nodo 14 (Split items):** implementado como Code node (no Item Lists) porque la versión gratuita de n8n no tiene "Split Out Items".
- **Nodo 17 (Call OpenAI):** operación "Message a Model". Mensajes vía `{{ $json.messages[0].content }}` (system) y `{{ $json.messages[1].content }}` (user).

---

## Verificación end-to-end (última corrida validada)

Corrida del 2026-07-02:

| Métrica | Valor |
|---|---|
| Canales verificados | Mercado Libre (mock) + WooCommerce (real Docker) |
| Nodos ejecutados | 22 en cadena WC |
| Latencia webhook → WA | ~3 s |
| `execution_entity.status` | `success` |
| `ai_notifications.message_status` | `sent` |
| `wa_message_id` | presente (Meta lo confirma) |
| Números reales confirmados | +542613075850, +542613678080, +542615915390 |

---

## Repo

- **Remote:** https://github.com/NicolasLlaneza/flowpedidos
- **Rama principal:** `main`
- **Último commit relevante:** `00e626d` — feat(multichannel): normalizador WooCommerce + entrypoint canónico

---

## Próximos pasos (roadmap corto)

1. **Sesión ML real** — test users de Mercado Libre + ngrok para exponer webhook `/ml-order` a internet.
2. **Dry runs** — miércoles 2026-07-01, correr la demo completa solo.
3. **Defensa** — jueves 2026-07-02. Ver guion de defensa (10 min) trabajado en la conversación.
4. **Post-defensa (línea futura):** Tiendanube/Shopify, canal bidireccional (respuestas del cliente), estudio de campo con una PyME.
