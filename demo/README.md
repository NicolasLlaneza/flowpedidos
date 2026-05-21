# Demo CLI — FlowPedidos

Demostración del pipeline funcionando end-to-end desde la línea de comandos. Pensado para grabar un video que muestre que la lógica de la arquitectura funciona de verdad.

## Qué hace

Ejecuta el pipeline completo sobre pedidos reales del dataset:

```
webhook → validación → enrich (mock ML) → normalización → idempotencia →
persistencia (Postgres) → seudonimización → IA (OpenAI) → fallback → auditoría
```

Replica la lógica exacta de los nodos de n8n (`n8n-workflows/lib/*.js`) pero como script standalone, para no depender de armar el workflow visual.

## Requisitos

- Stack levantado: `docker compose up -d`
- Crédito en OpenAI (sin esto, los mensajes salen por plantilla de respaldo)
- `npm install` ya ejecutado en esta carpeta

## Uso

```bash
# 1. Preparar entorno (copia fixtures al mock + limpia la base)
node reset.mjs

# 2. Correr la demostración (secuencia curada para grabar)
node run-demo.mjs

# Procesar pedidos específicos en vez de la secuencia curada:
node run-demo.mjs 3000000000000010 3000000000000020
```

## Secuencia curada

`run-demo.mjs` sin argumentos procesa una secuencia que cuenta una historia:

1. **Pedido 1** — happy path completo (con IA si hay crédito)
2. **Pedido 2** — otro pedido, muestra consistencia
3. **Pedido 1 otra vez** — demuestra el control de duplicados (idempotencia)
4. **Pedido 4** — fuerza una falla de IA para demostrar el fallback (resiliencia)
5. **Webhook inválido** — demuestra la validación y el rechazo

## Para grabar el video

Ver [`GUION-NARRACION.md`](GUION-NARRACION.md) — tiene qué decir en voz off durante cada parte.

Pasos:
1. Cargar crédito en OpenAI
2. `node reset.mjs`
3. Maximizar terminal, fuente grande, tema oscuro
4. Grabar pantalla (OBS) mientras corre `node run-demo.mjs`
5. Narrar siguiendo el guion

## Dos formas de demostrar

### A) Dashboard web (recomendado — más visual)

Una página con la marca FlowPedidos que muestra el pipeline procesando en vivo: barra de etapas que se iluminan, tabla de pedidos, mensajes estilo chat y stats. Datos 100% reales del backend.

```bash
# 1. Stack arriba + base limpia
docker compose up -d
node reset.mjs

# 2. Levantar el dashboard
node web/server.mjs
# → abrir http://localhost:4000
```

En la página: botón **"Procesar siguiente pedido"** ejecuta el pipeline real sobre el próximo pedido de la secuencia y anima el resultado. **"Reiniciar"** limpia todo para volver a grabar.

### B) CLI (terminal)

```bash
node reset.mjs
node run-demo.mjs
```

## Archivos

| Archivo | Qué es |
|---|---|
| `web/server.mjs` | Servidor del dashboard (API + estáticos) |
| `web/public/index.html` | Dashboard FlowPedidos (página única) |
| `lib/orchestrator.mjs` | Orquestación que devuelve datos estructurados (la usa el server) |
| `run-demo.mjs` | Runner CLI con trace en terminal |
| `reset.mjs` | Copia fixtures al mock + limpia la base |
| `lib/pipeline.mjs` | Lógica del pipeline (misma que los nodos n8n) |
| `GUION-NARRACION.md` | Guion de voz en off para el video |

## Nota sobre el puerto de Postgres

El demo se conecta a Postgres en el puerto `PG_HOST_PORT` del `.env` (default 5433). Se usa 5433 en vez de 5432 para evitar choque con un PostgreSQL instalado localmente en la máquina.
