# Dataset de pedidos simulados

50 pedidos sintéticos para la simulación controlada del cap 4.4. Diseñados para cubrir el ciclo completo de estados del modelo canónico, distintos tipos de producto y condiciones de error representativas.

## Distribución diseñada

### Por estado del pedido (n=50)
| Estado normalizado | Cantidad | % | Justificación |
|---|---:|---:|---|
| `paid`              | 18 | 36% | Estado más frecuente en operación real, happy path |
| `shipped`           | 12 | 24% | Etapa logística, segundo más común |
| `delivered`         |  8 | 16% | Cierre exitoso del ciclo |
| `pending_payment`   |  4 |  8% | Pagos en proceso |
| `cancelled`         |  4 |  8% | Cancelaciones (buyer/seller) |
| `refunded`          |  2 |  4% | Reembolsos completos |
| `error`             |  2 |  4% | Estado ML desconocido → mapeado a error |

### Por tipo de producto (n=50)
| Tipo | Cantidad |
|---|---:|
| Pedido de un solo neumático individual | 18 |
| Pedido de 2 neumáticos del mismo modelo | 12 |
| Kit de 4 ruedas | 6 |
| Multi-item: neumáticos + servicio (alineación/balanceo) | 9 |
| Solo servicio | 3 |
| Producto con título extremadamente largo (edge case) | 2 |

### Edge cases incluidos (parte de los 50)
| Caso | Cantidad | Por qué |
|---|---:|---|
| Webhook con campo `resource` faltante | 1 | Test de validación → debe responder 400 |
| Webhook con `topic` no soportado | 1 | Test de validación |
| Pedido con buyer_id nulo | 1 | Test de robustez del normalizador |
| Pedido con status ML desconocido | 2 | Test de mapeo a `error` |
| Pedido con monto muy alto (>500k ARS) | 1 | Test de precisión numérica |
| Pedido con monto muy bajo (<30k ARS) | 1 | Test de extremo opuesto |
| Pedido duplicado (mismo external_id) | 1 | Test de idempotencia |
| Pedido sin items | 1 | Test de defensa en normalizador |

### Distribución temporal
Los pedidos están distribuidos en los últimos 30 días desde la generación, con concentración en las últimas 2 semanas (simula tráfico real con cola de pedidos antiguos).

### Distribución geográfica (provincia)
Mendoza (60%), Buenos Aires (15%), Córdoba (10%), San Juan (8%), Otros (7%).

### Métodos de pago
- Tarjeta de crédito (50%)
- Cuenta Mercado Pago (30%)
- Tarjeta de débito (15%)
- Transferencia (5%)

## Reproducibilidad

El dataset se genera con un PRNG sembrado (`seed=42`). Re-ejecutar `node generate.mjs` produce **exactamente** los mismos 50 archivos. Cambiar `--seed N` produce un dataset distinto pero igualmente determinístico.

```bash
node dataset/generate.mjs                  # seed=42 (default)
node dataset/generate.mjs --seed 100       # otro dataset reproducible
node dataset/generate.mjs --count 100      # generar más
```

## Estructura de salida

```
dataset/
├── README.md                  ← este archivo
├── generate.mjs               ← generador con PRNG sembrado
└── seed-42/                   ← output con seed por defecto
    ├── manifest.json          ← índice de los 50 pedidos con sus metadatos
    ├── manifest.csv           ← lo mismo en CSV para análisis en planilla
    ├── orders/                ← respuestas mock de GET /orders/{id}
    │   ├── 3000000000000001.json
    │   ├── 3000000000000002.json
    │   └── ...
    └── webhooks/              ← payloads que simulan la notificación de ML
        ├── 3000000000000001.json
        ├── 3000000000000002.json
        └── ...
```

El manifest permite hacer queries del estilo:
- "todos los pedidos con edge_case_type=duplicate"
- "todos los pedidos con status=cancelled"
- "tiempo promedio de procesamiento agrupado por tipo de producto"

## Uso durante la simulación (Fase 5)

```bash
# Copiar los orders al mock-marketplace
cp dataset/seed-42/orders/*.json mocks/data/orders/

# Levantar el stack si está bajado
docker compose up -d

# Disparar los 50 webhooks secuencialmente
for f in dataset/seed-42/webhooks/*.json; do
    id=$(basename "$f" .json)
    ./mocks/send-webhook.sh "$id" "http://localhost:5678/webhook/ml-order"
    sleep 0.5
done

# Después correr las queries SQL del cap 6 sobre tfi.audit_log y tfi.v_order_summary
```

## Consideraciones para el documento

- En la **tesis (cap 4.4)** debe mencionarse explícitamente que el dataset es sintético, que el seed está versionado y que la distribución se diseñó para cubrir el dominio operativo de una PyME.
- En el **Anexo C** incluir el `manifest.csv` y la presente justificación de la distribución.
- Si el evaluador pregunta "por qué estos 50 y no otros", la respuesta defensiva es: distribución motivada por estados frecuentes en e-commerce + edge cases con propósito de robustez + reproducibilidad por seed.
- Una **limitación a declarar** (cap 4.8): la distribución refleja un escenario asumido por los autores, no datos empíricos de una empresa real. Esto se mitiga con la validación exploratoria del fix #8 (5-10 pedidos reales anonimizados).
