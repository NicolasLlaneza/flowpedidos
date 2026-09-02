# Dataset de pedidos simulados

**150 pedidos sintéticos** distribuidos entre los dos canales integrados
(Mercado Libre y WooCommerce), diseñados para cubrir el ciclo completo de
estados del modelo canónico, distintos tipos de producto y condiciones de
error representativas. Regenerado en Bloque E (v1.3.0) desde n=50 para
habilitar validación estadística — el intervalo de Wilson al 95% requiere
más de 100 casos únicos para no ser inconcluyente.

## Distribución diseñada (n=150)

### Por canal
| Canal | Cantidad | % |
|---|---:|---:|
| `mercadolibre` | 75 | 50% |
| `woocommerce`  | 75 | 50% |

La cuota es 50/50 por asignación par/impar sobre el índice del generador
(mantiene reproducibilidad y ubica los 7 edge cases distribuidos entre
ambos canales según parity).

### Por estado canónico
| Estado | Cantidad | % | Justificación |
|---|---:|---:|---|
| `paid`              | 54 | 36% | Estado más frecuente en operación real, happy path |
| `shipped`           | 36 | 24% | Etapa logística, segundo más común |
| `delivered`         | 24 | 16% | Cierre exitoso del ciclo |
| `pending_payment`   | 12 |  8% | Pagos en proceso |
| `cancelled`         | 12 |  8% | Cancelaciones (buyer/seller) |
| `refunded`          |  6 |  4% | Reembolsos completos |
| `error`             |  6 |  4% | Estado ML/WC desconocido → mapeado a error |

### Por tipo de producto
| Tipo | Cantidad |
|---|---:|
| Pedido de un solo neumático individual | 54 |
| Pedido de 2 neumáticos del mismo modelo | 36 |
| Kit de 4 ruedas | 18 |
| Multi-item: neumáticos + servicio | 27 |
| Solo servicio | 9 |
| Producto con título extremadamente largo (edge case) | 6 |

### Los siete casos límite (fijos por índice)
| idx | Caso | Por qué se conserva |
|---:|---|---|
|  5 | `no_resource` (ML: sin campo resource) | Test de validación → 400 |
| 12 | `unsupported_topic` (ML: topic no soportado) | Test de validación |
| 19 | `null_buyer_id` | D1: substituto determinístico `synthetic:{channel}:{id}` |
| 26 | `high_value` (>500k ARS) | Precisión numérica en persistencia |
| 33 | `low_value` (<10k ARS) | Extremo opuesto |
| 41 | `duplicate` (mismo external_id que el pedido previo) | Idempotencia por (external_id, channel) |
| 47 | `no_items` (line_items vacío) | D2: mensaje se genera aunque no haya ítems |

Los siete se conservan en el dataset aunque los bugs de D1/D2 estén
corregidos: el trabajo reporta el antes y el después de la corrección.

## Reproducibilidad

El dataset se genera con un PRNG sembrado (`seed=42`) y una asignación
determinística por índice. Re-ejecutar `node generate.mjs` produce
**exactamente** los mismos 150 archivos. Cambiar `--seed N` produce un
dataset distinto pero igualmente determinístico.

```bash
node dataset/generate.mjs                  # seed=42, count=150 (default)
node dataset/generate.mjs --seed 100       # otro dataset reproducible
node dataset/generate.mjs --count 300      # otro tamaño manteniendo cuotas
```

## Estructura de salida

```
dataset/
├── README.md                    ← este archivo
├── generate.mjs                 ← generador con PRNG sembrado
└── seed-42/                     ← output con seed por defecto
    ├── manifest.json            ← índice de los 150 pedidos con canal, estado, edge case
    ├── manifest.csv             ← lo mismo en CSV para análisis en planilla (Anexo C)
    ├── orders/                  ← ML: respuesta simulada de GET /orders/{id}
    │   ├── 3000000000000001.json    (canal según parity del idx)
    │   ├── ...                       WC: mismo payload que webhooks/, por simetría
    │   └── 3000000000000150.json
    └── webhooks/                ← notificación al endpoint del pipeline
        ├── 3000000000000001.json    ML: shape webhook {resource, topic, user_id}
        ├── ...                       WC: shape orden completa (WC envía el pedido en el body)
        └── 3000000000000150.json
```

El manifest permite queries del estilo:
- todos los pedidos WooCommerce con `canonical_status='cancelled'`
- todos los pedidos con `edge_case='duplicate'`
- distribución de `items_count` por canal

## Uso durante la corrida definitiva

```bash
# Copiar los orders ML al mock-marketplace (para el enrich del pipeline)
cp dataset/seed-42/orders/*.json mocks/data/orders/

# Levantar el stack si está bajado
docker compose up -d

# Disparar los webhooks del canal ML
jq -r '.items[] | select(.channel=="mercadolibre") | .external_id' dataset/seed-42/manifest.json \
| while read id; do
    curl -sS -X POST http://localhost:5678/webhook/ml-order \
      -H 'Content-Type: application/json' \
      --data-binary @dataset/seed-42/webhooks/$id.json
    sleep 0.2
  done

# Disparar los webhooks del canal WC
jq -r '.items[] | select(.channel=="woocommerce") | .external_id' dataset/seed-42/manifest.json \
| while read id; do
    curl -sS -X POST http://localhost:5678/webhook/wc-order \
      -H 'Content-Type: application/json' \
      --data-binary @dataset/seed-42/webhooks/$id.json
    sleep 0.2
  done

# Después: queries del Anexo C sobre tfi.audit_log y tfi.v_order_summary
# Métrica principal (§3.3): orders.received_at → ai_notifications.dispatched_at
```

## Consideraciones para el documento

- El Cap. 3.5 debe declarar: dataset sintético, seed versionado, distribución
  motivada por estados frecuentes del dominio (no datos empíricos de una
  empresa real).
- El Anexo C incluye `manifest.csv` y la presente justificación.
- Con n=150 el intervalo de Wilson al 95% cubre validación de la hipótesis H2
  (tasa de normalización >95%), lo que no era posible con n=50 (el brief lo
  identifica explícitamente como bloqueo del análisis anterior).
- Los siete edge cases quedan como bloques trazables: la tabla del capítulo
  de Resultados puede reportar antes/después de la corrección de D1/D2.
- Limitación a declarar (§3.9): la distribución refleja un escenario
  asumido por los autores, no datos empíricos.
