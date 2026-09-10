# Estadísticos del pipeline automatizado — Corrida baseline WC (n=10)

**Fecha:** 2026-09-10
**Origen:** 10 pedidos WooCommerce reales, canal live, ventana 24h Meta activa
**Fuente:** `out/baseline-pipeline-times.csv`
**Consulta:** `tfi.orders` ⋈ `tfi.ai_notifications` (últimos 15 min al momento de la corrida)

## Métricas por etapa (ms)

| Métrica       | min  | mean | p50  | p95  | max  |
|---------------|------|------|------|------|------|
| **ack_ms** (received → ack)        | 0    | 0    | 0    | 0    | 0    |
| **llm_ms** (received → LLM generated) | 984  | 1173 | 1124 | 1391 | 1449 |
| **dispatch_ms** (LLM → dispatched)     | 1272 | 1365 | 1354 | 1466 | 1472 |
| **e2e_ms** (received → dispatched)     | 2352 | 2538 | 2512 | 2769 | 2780 |
| **llm_latency_ms** (call OpenAI)       | 913  | 1101 | 1053 | 1325 | 1379 |

## Costo

- **Total 10 pedidos:** USD 0.001460
- **Por pedido:** USD 0.000146 promedio
- Proyección diaria (1000 pedidos): USD 0.146
- Proyección mensual (30k pedidos): USD 4.38

## Interpretación

- **e2e mediano ~2.5s**: entre que WooCommerce dispara el webhook y el WhatsApp queda dispatched a Meta pasan 2.5s en promedio, con p95 en 2.77s.
- **Composición del e2e**: ~46% LLM (generación mensaje), ~54% dispatch (validación + envío a Meta + confirmación wamid). Cero fricción en ACK.
- **ACK 0ms**: el ACK es sincrónico con `received_at` (el webhook responde inmediatamente al recibir). Requisito B1 (ACK < 500ms) cumplido con enorme margen.
- **Costo por pedido despreciable**: USD 0.000146 usando `gpt-4o-mini`, dentro del presupuesto anual proyectado en Cap. 5.

## Nota metodológica sobre esta corrida

- **n=10** — muestra pequeña, con propósito de validar end-to-end en modo live y demostrar tolerancia multi-número (3 destinatarios distintos verificados en Meta).
- Para las hipótesis H1/H2/H3 con intervalos Wilson 95%, ver la corrida definitiva n=150 (`out/corrida-definitiva.csv`).
- Los tiempos aquí incluyen el `delay=20000ms` entre requests para no gatillar spam de Meta — ese delay es artificial del script, no del pipeline. Los timings por pedido son independientes del delay.
