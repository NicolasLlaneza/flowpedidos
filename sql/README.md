# Modelo de datos canónico

Schema dedicado `tfi` que aísla nuestras tablas de las internas de n8n (en `public`).

## Mapeo doc tesis ↔ implementación

| Sección 5.5 doc | Tabla implementada |
|---|---|
| Orden            | `tfi.orders` |
| Ítem de Orden    | `tfi.order_items` |
| Cliente          | `tfi.customers` |
| AI_Notifications | `tfi.ai_notifications` |
| Audit_Log        | `tfi.audit_log` |

## Entidades

### `tfi.customers`
Compradores normalizados. Conserva PII para auditoría operativa pero expone solo `pseudonym` al LLM (privacidad por diseño, cap 5.7).
- `pseudonym`: token opaco enviado en lugar de nombre/email
- `email_hash` / `phone_hash`: SHA-256 para deduplicación entre canales sin exponer el dato
- Trigger `customers_set_updated_at` actualiza `updated_at` en cada UPDATE

### `tfi.orders`
Entidad central del modelo canónico.
- **Idempotencia**: `UNIQUE(external_id, channel)` rebota webhooks duplicados
- **CHECK constraints** sobre `status` y `channel` validan el dominio del modelo canónico
- `raw_payload` (JSONB) preserva el evento original para re-procesar si cambia el adaptador
- `normalization_version`: versiona el mapeo aplicado (futuro: migración de adaptadores)

### `tfi.order_items`
Productos del pedido. `ON DELETE CASCADE` desde orders.

### `tfi.ai_notifications`
Diseñada para soportar los experimentos del marco metodológico:
- **Cost tracking**: `prompt_tokens`, `completion_tokens`, `cost_usd` (numeric 10,6 — fracciones de centavo)
- **Comparación de proveedores**: `provider` + `model` permiten correr el mismo dataset contra OpenAI vs Anthropic (Fase 6)
- **Prompt versioning**: `prompt_version` apunta a `/prompts/vN.md` del repo
- **Fallback**: `is_fallback=true` + `provider='template'` cuando se degrada a plantilla (CHECK constraint asegura coherencia)

### `tfi.audit_log`
Insert-only. Una fila por evento del pipeline.
- `bigserial` PK (no uuid) porque es alto volumen y queremos orden temporal natural
- `ON DELETE SET NULL` desde orders para que el log sobreviva si se purga un pedido
- Índice parcial sobre `severity IN ('error','critical')` para queries de incidentes rápidas

## Vista de soporte

`tfi.v_order_summary` calcula `processing_ms`, conteo de items y notificaciones, y flag de uso de fallback. Es el punto de entrada de las queries del cap 6 (Análisis del tiempo de procesamiento).

## Decisiones de diseño

1. **Schema separado `tfi`**: evita colisión con tablas de n8n. Las queries deben usar `tfi.tabla` o `SET search_path TO tfi`.
2. **UUID en vez de serial para PKs de negocio**: evita filtrar volumen al exterior si exponemos IDs en APIs futuras.
3. **`timestamptz` siempre**: timezone-aware. El container corre en `America/Argentina/Mendoza` (configurado en compose).
4. **JSONB en vez de TEXT** para `raw_payload` y `metadata`: indexable, eficiente, queryable con operadores `->`, `@>`.
5. **CHECK constraints sobre status y channel**: el modelo canónico define qué valores son válidos; cualquier valor fuera de la lista es bug del adaptador, no dato.
6. **`audit_log` sin FK obligatoria a orders**: hay eventos pre-order (webhook recibido con JSON inválido) que igual deben loguearse.

## Roles y permisos (02_roles.sql)

Dos usuarios postgres con propósitos distintos:

| Usuario | Rol | Para qué |
|---|---|---|
| `n8n`     | superuser   | n8n interno: guarda sus workflows, credenciales encriptadas y ejecuciones en `public.*` |
| `tfi_app` | restringido | El pipeline lo usa para CRUD sobre `tfi.*`; sin permisos sobre `public`, sin DDL |

`tfi_app` aplica el principio de mínimo privilegio del cap 5.7:
- `GRANT USAGE` solo sobre schema `tfi`
- `SELECT, INSERT, UPDATE, DELETE` sobre tablas existentes
- `USAGE, SELECT` sobre secuencias (para `audit_log.bigserial`)
- **No puede** DROP, TRUNCATE, ALTER ni acceder a `public`
- `ALTER DEFAULT PRIVILEGES` propaga estos permisos a tablas futuras

Configurar la credencial en n8n con `host=postgres`, `database=tfi`, `user=tfi_app`, password desde `.env`.

## Cómo aplicar (en arranque limpio)

El bind mount `./sql:/docker-entrypoint-initdb.d` carga ambos archivos automáticamente la primera vez que postgres inicializa su volumen. El script `02_roles.sql` requiere que la variable `tfi.app_password` esté seteada — en arranque limpio, postgres no la tiene, así que conviene aplicarla manualmente la primera vez:

```bash
# 1. Schema base
docker compose exec -T postgres psql -U n8n -d tfi < sql/01_schema.sql

# 2. Roles (inyectando el password desde .env)
(echo "SET tfi.app_password = '${TFI_APP_PASSWORD}';"; cat sql/02_roles.sql) | \
    docker compose exec -T postgres psql -U n8n -d tfi -v ON_ERROR_STOP=1
```

## Smoke test ejecutado

✅ 23 índices creados, 5 tablas + 1 vista + 1 schema_version
✅ Constraint `orders_external_uq` rebota duplicados con el error esperado
✅ Vista `v_order_summary` lee correctamente
✅ Schema versión `v1.0.0` registrada
