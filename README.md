# Flow Pedidos

Arquitectura de integración multicanal para la automatización de comunicaciones
posventa en PyMEs de comercio electrónico. Recibe los eventos de pedido de varias
plataformas de venta, los normaliza a un modelo de datos propio, genera con un
modelo de lenguaje una notificación contextualizada y la despacha al cliente por
WhatsApp, con validación determinística previa al envío y degradación a plantilla
estática cuando esa validación no se satisface.

Es el artefacto del Trabajo Final Integrador de la Tecnicatura Universitaria en
Programación, UTN FRM, 2026.

**Autores:** Nicolás Llaneza, Miguel Barrera Oltra, Sabrina Moreira
**Director:** Mag. Ing. Alberto Cortez

---

## Qué hace

Dos canales de entrada, un pipeline único:

```
webhook (Mercado Libre | WooCommerce)
   │
   ├─ validación estructural  ──────────────► rechazo + audit_log
   ├─ persistencia del evento crudo (raw_events)
   ├─ HTTP 200 al emisor            ◄── se responde acá, antes de procesar
   │
   ├─ enriquecimiento (ML: consulta a la API de órdenes)
   ├─ normalización al modelo canónico ─────► estado desconocido → rama de error
   ├─ verificación de idempotencia ─────────► duplicado → audit_log
   ├─ persistencia (customers, orders, order_items)
   │
   ├─ construcción del contexto  ◄── sin identificadores del comprador
   ├─ generación (GPT-4o-mini)
   ├─ rehidratación + validador de siete reglas ──► falla → plantilla estática
   └─ despacho (WhatsApp Business Cloud API) + audit_log
```

La confirmación al emisor se emite antes del procesamiento porque Mercado Libre
exige responder dentro de los 500 ms; el evento ya quedó persistido en ese punto,
de modo que la respuesta temprana no pierde información.

El nombre del cliente nunca sale hacia el proveedor del modelo: el contexto viaja
sin identificadores y el nombre se sustituye localmente, después de generar.

## Stack

| Componente | Rol |
|---|---|
| n8n | Orquestación del pipeline (fair-code, Sustainable Use License) |
| PostgreSQL 16 | Modelo de datos canónico, auditoría e instrumentación |
| OpenAI GPT-4o-mini | Generación de las notificaciones |
| WhatsApp Business Cloud API | Canal de despacho |
| WordPress + WooCommerce + MySQL | Segundo canal de entrada, instalación de prueba real |
| nginx | Simulador de la API de Mercado Libre |
| ngrok | Exposición del endpoint para los webhooks entrantes |

## Puesta en marcha

Requiere Docker Desktop con Compose v2 y una clave de API de OpenAI.

```bash
cp .env.example .env      # completar con las credenciales propias
docker compose up -d
docker compose ps         # esperar a que los healthchecks pasen (~30 s)
node scripts/env-check.mjs
```

n8n queda en `http://localhost:5678` y pide crear el usuario propietario la
primera vez. El workflow se importa desde `n8n-workflows/workflow.json`.

Las migraciones posteriores al esquema inicial se aplican a mano:

```bash
docker compose exec -T postgres psql -U n8n -d tfi < sql/03_wa_dispatch.sql
docker compose exec -T postgres psql -U n8n -d tfi < sql/04_instrumentation.sql
```

`sql/01_schema.sql` y `sql/02_roles.sql` los carga Postgres solo, por el bind
mount `./sql:/docker-entrypoint-initdb.d`, la primera vez que inicializa el
volumen. `sql/README.md` detalla el orden y las salvedades.

## Estructura

```
n8n-workflows/     Workflow exportado, código de los nodos (lib/) y SQL de los
                   nodos Postgres (sql/). Es el corazón del sistema.
sql/               DDL del modelo canónico, roles y migraciones.
prompts/           Prompt de producción versionado (v1 y v2).
dataset/           Generador reproducible de pedidos sintéticos (seed=42) y las
                   fixtures que produce.
mocks/             Simulador de la API de Mercado Libre (nginx) y webhooks de
                   prueba.
demo/              Panel operativo y CLI que ejecutan el pipeline para mostrarlo
                   funcionando.
scripts/           Utilitarios de puesta en marcha, corrida y verificación.
docker-compose.yml Definición de los servicios.
```

## Estado y limitaciones conocidas

El sistema está operativo de extremo a extremo en ambos canales, con despacho
real contra credenciales de producción de la API de mensajería en el canal de
WooCommerce. Tres defectos identificados y no corregidos al momento de la
entrega:

- No hay política de reintentos ante el cierre de conexión del proveedor del
  modelo. El reintento previsto no se ejecuta porque la función de red que lo
  implementa no está disponible en el entorno de los nodos de código de n8n; el
  pipeline degrada directamente a la plantilla estática.
- La rama de degradación a estado de error no está aislada de la inserción de
  ítems.
- `raw_events` persiste el payload antes del ACK, pero no hay un consumidor con
  reintento sobre esa tabla: la recuperación de un evento interrumpido es manual.

No se ejecutaron pruebas de carga ni de concurrencia. El volumen procesado en la
corrida reportada fue de 150 pedidos en condiciones controladas.

---

## Evidencia y reproducibilidad

Este repositorio publica también los datos que sostienen las afirmaciones
empíricas del documento, de modo que puedan verificarse por reejecución.

| Documento | Archivo |
|---|---|
| Anexo B — modelo de datos | `sql/01_schema.sql`, `sql/02_roles.sql`, `sql/03_wa_dispatch.sql`, `sql/04_instrumentation.sql` |
| Anexo C — flujos de n8n | `n8n-workflows/workflow.json`, `n8n-workflows/test-plan.md` |
| Anexo F — prompt de producción | `prompts/v2.md` (`prompts/v1.md` para el contraste de la sección 6.2) |
| Anexo G — panel de calidad | `out/panel/`, `scripts/panel/` |
| Anexo H — corrida con despacho real | `out/corrida-v2.csv` |
| Sección 3.5 — conjunto sintético | `dataset/generate.mjs`, `dataset/seed-42/manifest.csv` |
| Sección 5.3 — canal simulado | `out/corrida-v2-ml.csv` |

`out/README.md` y `scripts/panel/README.md` detallan archivo por archivo qué
contiene cada uno y qué afirmación respalda.

Los identificadores de mensaje que devuelve la API de WhatsApp se publican como
hash: el identificador original incorpora el teléfono del destinatario en
base64. `scripts/sanitize-wamid.py` implementa esa sustitución y documenta el
motivo. Los mapas que permitirían revertir la seudonimización de destinatarios y
evaluadores no están versionados.

## Licencia y alcance

Trabajo académico. n8n se distribuye bajo Sustainable Use License, no bajo una
licencia de código abierto en sentido estricto; su uso comercial tiene
restricciones que conviene revisar antes de reutilizar esta arquitectura.
