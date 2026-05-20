# Mock de Marketplace (estilo Mercado Libre)

Container nginx que sirve fixtures JSON estáticos imitando la API real de Mercado Libre. Permite que n8n haga el `enrich` después de recibir un webhook, sin depender de la plataforma real durante desarrollo y simulación.

## Endpoints

| Endpoint | Devuelve |
|---|---|
| `GET /healthz` | `{"status":"ok"}` |
| `GET /orders/{id}` | El detalle del pedido (mismo shape que ML real) |

Internamente sirve los archivos en `mocks/data/` con resolución `try_files $uri $uri.json` (configurada en `nginx.conf`).

## URLs

- Desde el host: `http://localhost:3001`
- Desde otros containers (n8n): `http://mock-marketplace` (red interna `tfi-net`)

## Fixtures incluidos

### Pedidos (`/orders/{id}`)

| ID | Estado | Caso de uso |
|---|---|---|
| 2000003508052235 | `paid`      | Happy path: pago aprobado, listo para envío |
| 2000003508052236 | `shipped`   | Múltiples items (neumáticos + servicio), en tránsito |
| 2000003508052237 | `cancelled` | Cancelación por comprador, pago revertido |
| 2000003508052238 | `delivered` | Pedido completo, entregado |

### Webhooks (`mocks/webhooks/`)

JSONs que simulan la notificación que ML enviaría al webhook de n8n.

| Archivo | Caso |
|---|---|
| `paid-2235.json`              | Pedido pagado, primer intento |
| `shipped-2236.json`           | Pedido enviado |
| `cancelled-2237.json`         | Pedido cancelado |
| `delivered-2238.json`         | Pedido entregado |
| `duplicate-2235.json`         | Reenvío del mismo pedido (attempts=2) — test idempotencia |
| `invalid-missing-resource.json` | Falta el campo `resource` — test validación |

## Uso

### Disparar un webhook a n8n

```bash
./mocks/send-webhook.sh paid-2235
./mocks/send-webhook.sh duplicate-2235
./mocks/send-webhook.sh invalid-missing-resource
```

Por default apunta a `http://localhost:5678/webhook/ml-order`. Si tu workflow en n8n usa otro path:

```bash
./mocks/send-webhook.sh paid-2235 http://localhost:5678/webhook-test/mi-flow
```

### Consultar un pedido directamente (lo que hará n8n en el paso de enrich)

```bash
curl http://localhost:3001/orders/2000003508052236 | jq
```

## Decisiones de diseño

- **nginx alpine en vez de json-server**: imagen 50× más chica, sin dependencias JS, configuración explícita
- **Archivos estáticos en `mocks/data/`**: cada fixture es un archivo separado → fácil de versionar, revisar en PR, y agregar
- **Misma estructura que la API real de ML**: cuando llegue el momento de conectarse a producción, los adaptadores de normalización no necesitan cambios
- **Webhooks separados de respuestas**: los webhooks viven en `mocks/webhooks/` y los detalles en `mocks/data/orders/` — refleja la separación que hace la plataforma real (notificación liviana + consulta posterior)
