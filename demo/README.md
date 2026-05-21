# Demo — FlowPedidos

Dos formas de demostrar que la arquitectura funciona de verdad:

- **Panel operativo (MVP)** — un dashboard tipo producto, recomendado para el video del coordinador.
- **CLI** — trace técnico en terminal, paso a paso del pipeline.

Ambas ejecutan el pipeline real:

```
webhook → validación → enrich → normalización (modelo canónico) → idempotencia →
persistencia (PostgreSQL) → seudonimización → IA (OpenAI) → fallback → auditoría
```

La lógica es la misma que la de los nodos de n8n (`n8n-workflows/lib/*.js`), implementada como módulos standalone para no depender de armar el workflow visual.

## Requisitos

- Stack levantado: `docker compose up -d`
- `npm install` ya ejecutado en esta carpeta (instala `pg`)
- Crédito en OpenAI **solo** para regenerar mensajes; los del seed ya están cacheados en `web/ai-cache.json`

## A) Panel operativo (MVP) — recomendado

```bash
# 1. Levantar el panel
node web/server.mjs
# → abrir http://localhost:4000

# 2. Si está vacío, presionar "Cargar pedidos" en la página
#    (ingesta ~24 pedidos multicanal por el pipeline real; usa cache de IA)
```

El panel muestra:
- **KPIs**: pedidos procesados, ingresos, pendientes, mensajes enviados, canales activos
- **Filtros**: por canal, por estado, búsqueda por cliente/producto/N°
- **Tabla de pedidos** unificada (todos los canales en una vista)
- **Detalle** de cada pedido: cliente + seudónimo (con nota de privacidad), productos, mensaje enviado al cliente, y trazabilidad cronológica

Botones: **Cargar pedidos** (seed) y **Vaciar** (limpia la base).

## B) CLI (terminal)

```bash
node reset.mjs        # copia fixtures al mock + limpia la base
node run-demo.mjs     # trace paso a paso de una secuencia curada
```

La secuencia cuenta una historia: happy path → consistencia → duplicado bloqueado (idempotencia) → fallback (resiliencia) → webhook rechazado (validación).

## Para grabar el video

Ver [`GUION-NARRACION.md`](GUION-NARRACION.md) — guion de voz en off con terminología explicada, pensado para el panel operativo.

Pasos:
1. `node web/server.mjs` y abrir http://localhost:4000
2. Si está vacío, "Cargar pedidos"
3. Maximizar el navegador, zoom 110%
4. Grabar la pantalla (OBS) y narrar siguiendo el guion

## Archivos

| Archivo | Qué es |
|---|---|
| `web/server.mjs` | Servidor del panel (API de operación + estáticos) |
| `web/public/index.html` | Panel operativo (markup) |
| `web/public/app.js` | Lógica del panel (KPIs, filtros, detalle) |
| `web/ai-cache.json` | Mensajes de IA cacheados (no se vuelve a gastar crédito) |
| `lib/orchestrator.mjs` | Pipeline + queries de operación (KPIs, listado, detalle, seed) |
| `lib/pipeline.mjs` | Lógica del pipeline (misma que los nodos n8n) |
| `lib/ai-cache.mjs` | Cache de mensajes IA en disco |
| `run-demo.mjs` | Runner CLI con trace en terminal |
| `reset.mjs` | Copia fixtures al mock + limpia la base |
| `GUION-NARRACION.md` | Guion de voz en off para el video |

## Cache de IA

Los mensajes se generan una vez con OpenAI y se guardan en `web/ai-cache.json`. Las corridas siguientes los reproducen: el panel **no gasta crédito** y funciona aunque OpenAI no esté disponible. Para regenerar, borrar el archivo y volver a seedear.

## Nota sobre el puerto de Postgres

El panel se conecta a Postgres en el puerto `PG_HOST_PORT` del `.env` (default 5433), para evitar choque con un PostgreSQL instalado localmente que ocupe el 5432.
