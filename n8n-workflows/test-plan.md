# Plan de tests del workflow FlowPedidos

Batería de casos de prueba que cubre las ramas del pipeline y los criterios del cap 6 de la tesis. Pensado para ejecutar **secuencialmente desde la línea de comandos** contra el webhook activo y verificar la base.

## Prerequisitos por test

```bash
# 1. Workflow activo en n8n (toggle en producción) o "Execute workflow" antes de cada disparo en test mode
# 2. Variables de WhatsApp cargadas en .env y n8n reiniciado
# 3. La URL del webhook:
#    - Producción (recomendada): http://localhost:5678/webhook/ml-order
#    - Test:                     http://localhost:5678/webhook-test/ml-order
# 4. Reset de la base antes de cada serie (no entre tests del mismo escenario)
```

Helper para resetear:
```bash
cd /d/Tesis-TFI/demo && node -e "
process.loadEnvFile('../.env');
import('pg').then(async ({default:pg})=>{
  const c = new pg.Client({host:'localhost',port:Number(process.env.PG_HOST_PORT)||5433,database:'tfi',user:'n8n',password:process.env.POSTGRES_PASSWORD});
  await c.connect();
  await c.query('TRUNCATE tfi.audit_log, tfi.ai_notifications, tfi.order_items, tfi.orders, tfi.customers RESTART IDENTITY CASCADE');
  await c.end();
});"
```

---

## T1 — Happy path (pedido nuevo, IA o fallback, WhatsApp enviado)

**Objetivo**: confirmar que el flujo entero funciona end-to-end.

**Pre**: base limpia.

**Payload**:
```json
{
  "resource": "/orders/3000000000000001",
  "topic": "orders_v2",
  "user_id": 123456789,
  "attempts": 1
}
```

**Disparo**:
```bash
curl -sS -X POST http://localhost:5678/webhook/ml-order \
  -H "Content-Type: application/json" \
  --data-binary '{"resource":"/orders/3000000000000001","topic":"orders_v2","user_id":123456789,"attempts":1}'
```

**Resultado esperado** (DB):
- `orders` = 1 fila (external_id 3000…001, status `paid`)
- `customers` = 1 fila (Juan Pérez, pseudonym `cust_…`)
- `order_items` = 1 fila
- `ai_notifications` = 1 fila (status `sent`, sent_at presente, wa_message_id con wamid)
- `audit_log` = 1+ filas (al menos `message_sent`)
- WhatsApp **llega** al teléfono del usuario

**Query de verificación**:
```sql
SELECT external_id, status, (SELECT message_status FROM tfi.ai_notifications n WHERE n.order_id=o.id) AS msg_status
FROM tfi.orders o;
```

✅ **Pasó hoy 2026-06-24**

---

## T2 — Idempotencia (mismo pedido dos veces)

**Objetivo**: confirmar que un webhook reenviado no duplica ni vuelve a notificar.

**Pre**: T1 ejecutado (orders ya tiene la fila).

**Disparo**: el MISMO payload de T1 otra vez (mismo external_id + channel).

**Resultado esperado** (DB):
- `orders` sigue en 1 fila
- `customers` sigue en 1 fila
- `order_items` sigue en 1 fila
- `ai_notifications` sigue en 1 fila (no se crea una nueva)
- `audit_log` suma una fila con `event_type=duplicate_detected`
- NO llega un segundo WhatsApp al teléfono

**Query**:
```sql
SELECT event_type, count(*)
FROM tfi.audit_log
GROUP BY event_type
ORDER BY event_type;
-- esperado: una fila con duplicate_detected
```

---

## T3 — Validación fallida (webhook sin campos requeridos)

**Objetivo**: confirmar que payloads inválidos se rechazan sin contaminar la base.

**Pre**: base limpia.

**Payload** (falta `resource`):
```json
{"topic":"orders_v2","user_id":123456789,"attempts":1}
```

**Disparo**:
```bash
curl -sS -X POST http://localhost:5678/webhook/ml-order \
  -H "Content-Type: application/json" \
  --data-binary '{"topic":"orders_v2","user_id":123456789,"attempts":1}'
```

**Resultado esperado**:
- HTTP **400** del webhook (no 200)
- `orders`, `customers`, `order_items`, `ai_notifications` siguen en 0
- `audit_log` tiene 1 fila con `event_type=validation_failed`, `severity=warning`
- NO llega WhatsApp

**Query**:
```sql
SELECT event_type, severity, message FROM tfi.audit_log;
```

---

## T4 — Topic no soportado

**Objetivo**: validar que la app filtra correctamente topics ajenos.

**Pre**: base limpia.

**Payload**:
```json
{"resource":"/orders/3000000000000001","topic":"questions","user_id":123456789,"attempts":1}
```

**Resultado esperado**: igual a T3 (rechazado), `errors` debe incluir `unsupported_topic:questions`.

---

## T5 — Resiliencia: fallback a plantilla cuando OpenAI falla

**Objetivo**: confirmar que el pipeline NO se rompe si OpenAI no está disponible.

**Pre**: base limpia. En el nodo "Call OpenAI" **invalidar la credencial momentáneamente** (cambiar la API key a algo inválido) o **forzar la rama** desactivando temporalmente el nodo OpenAI con "Continue On Fail" siempre activo.

**Payload**: el mismo de T1.

**Resultado esperado**:
- `ai_notifications.provider = 'template'`
- `ai_notifications.is_fallback = true`
- `ai_notifications.message_text` es la plantilla de respaldo
- El WhatsApp llega igual (con la plantilla)
- `audit_log` incluye `event_type=fallback_triggered`

---

## T6 — Estados variados (cubrir el ciclo de vida)

**Objetivo**: validar que distintos estados se normalizan y se mensajean correctamente.

Disparar (uno por uno, reseteando antes de la serie):

| Pedido | external_id | Estado esperado |
|---|---|---|
| Pagado | 3000000000000001 | `paid` |
| Enviado | 3000000000000021 | `shipped` |
| Entregado | 3000000000000031 | `delivered` |
| Pendiente de pago | 3000000000000039 | `pending_payment` |
| Cancelado | 3000000000000043 | `cancelled` |
| Reembolsado | 3000000000000047 | `refunded` |

**Query**:
```sql
SELECT external_id, status FROM tfi.orders ORDER BY external_id;
-- esperado: 6 filas, una por cada estado canónico
```

---

## T7 — Volumen (50 pedidos seguidos)

**Objetivo**: medir tiempo total y por pedido para reportar en cap 6.

**Pre**: base limpia. Workflow en producción.

**Disparo**:
```bash
cd /d/Tesis-TFI
START=$(date +%s%N)
for f in dataset/seed-42/webhooks/*.json; do
    curl -s -X POST http://localhost:5678/webhook/ml-order \
      -H "Content-Type: application/json" \
      --data-binary @"$f" > /dev/null
done
END=$(date +%s%N)
echo "Total: $(( (END - START) / 1000000 )) ms"
```

**Métricas a recolectar** (queries sobre `audit_log` y `ai_notifications`):
```sql
-- Latencia promedio del LLM
SELECT avg(latency_ms) AS llm_avg_ms FROM tfi.ai_notifications WHERE is_fallback = false;

-- Tasa de éxito IA vs fallback
SELECT provider, count(*) FROM tfi.ai_notifications GROUP BY provider;

-- Costo total
SELECT sum(cost_usd) FROM tfi.ai_notifications;

-- Tasa de duplicados detectados
SELECT count(*) FROM tfi.audit_log WHERE event_type = 'duplicate_detected';

-- Tasa de rechazo por validación
SELECT count(*) FROM tfi.audit_log WHERE event_type = 'validation_failed';

-- Tiempo de procesamiento por pedido (queriendo received_at y sent_at)
SELECT
    avg(extract(epoch from (n.sent_at - o.received_at))) AS avg_seconds
FROM tfi.orders o
JOIN tfi.ai_notifications n ON n.order_id = o.id
WHERE n.sent_at IS NOT NULL;
```

---

## T8 — Multi-canal

**Objetivo**: validar que el workflow procesa el mismo pedido como **canales distintos** (no como duplicados).

**Disparo**: 4 webhooks al mismo external_id pero el workflow asigna canal distinto a cada uno (esto se haría mejor con el panel del demo o modificando el normalizador para tomar canal del payload). Por ahora, manual:

Esto requiere desactivar la simplificación del normalizador donde channel está hardcoded en `mercadolibre`. Cuando el flujo soporte canal dinámico, ejecutar:

| Canal | external_id |
|---|---|
| mercadolibre | 3000000000000001 |
| whatsapp | 3000000000000003 |
| woocommerce | 3000000000000010 |
| tienda_nube | 3000000000000007 |

**Resultado esperado**: 4 filas en `orders`, 4 distinct values en `channel`.

---

## T9 — Privacidad: el LLM no recibe PII

**Objetivo**: validar empíricamente que el prompt enviado a OpenAI no contiene nombre, email ni teléfono.

**Cómo**:
- Activar logging extendido en el Code node "Build LLM prompt"
- Inspeccionar `sent_context` en la salida del nodo
- Verificar que solo aparece `customer_pseudonym` y nunca `full_name`, `email`, `phone`, `doc_number`

**Resultado esperado**: el guard de `pii_keys` del prompt builder rechaza el envío si detecta PII. En el camino feliz, solo el pseudónimo viaja al LLM.

---

## T10 — Caracterización cualitativa del mensaje (cap 6.4)

**Objetivo**: validar la rúbrica con 5 mensajes piloto antes de la corrida formal de 20.

**Cómo**:
- Ejecutar T6 (estados variados) → genera 6 mensajes con AI o plantilla
- Aplicar la rúbrica de la tesis sobre cada uno (claridad, tono, relevancia, corrección)
- Calcular ICC piloto entre los 3 evaluadores
- Ajustar la rúbrica si hay discrepancias

---

## Checklist de cierre antes del video

- [ ] T1 happy path
- [ ] T2 idempotencia
- [ ] T3 validación fallida (400)
- [ ] T5 fallback (resiliencia)
- [ ] T7 volumen (50 pedidos, métricas recolectadas)
- [ ] Capturas: canvas n8n, panel demo:4000, WhatsApp recibido
- [ ] Query final sobre `audit_log` para mostrar trazabilidad
