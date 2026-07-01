# FlowPedidos — Arquitectura de integración multicanal para PyMEs e-commerce

Trabajo Final Integrador, Tecnicatura Universitaria en Programación, UTN-FRM, 2026.

**Autores**: Nicolás Llaneza, Miguel Barrera Oltra, Sabrina Moreira
**Director**: Mag. Ing. Alberto Cortez

Recibe pedidos de múltiples canales (Mercado Libre, WooCommerce, Shopify, Tienda
Nube, WhatsApp), los normaliza a un **modelo de datos canónico**, y genera
automáticamente mensajes de comunicación post-venta al comprador con IA,
despachados por WhatsApp.

## Stack

- **n8n** — orquestador low-code del pipeline
- **PostgreSQL 16** — persistencia del modelo de datos canónico (schema `tfi`)
- **mock-marketplace** (nginx) — simula la API de Mercado Libre para el `enrich`
- **OpenAI GPT-4o-mini** — generación de mensajes contextualizados (modelo principal)
- **Anthropic Claude Haiku** — modelo comparativo (Fase 6)
- **Meta WhatsApp Business API** — despacho de notificaciones al cliente

## Prerequisitos

- Docker Desktop + Docker Compose v2
- API key de OpenAI (https://platform.openai.com/api-keys)
- Credenciales de Meta WhatsApp Business API (`WHATSAPP_PHONE_NUMBER_ID`,
  `WHATSAPP_ACCESS_TOKEN`) — solo para el despacho real por WhatsApp
- API key de Anthropic (https://console.anthropic.com/) — opcional, solo Fase 6

## Quickstart

```bash
# 1. Clonar y entrar
git clone <repo> flowpedidos && cd flowpedidos

# 2. Configurar variables
cp .env.example .env
# editar .env con tus claves reales

# 3. Levantar el stack
docker compose up -d

# 4. Esperar healthchecks (~30s) y verificar
docker compose ps

# 5. Abrir n8n
# http://localhost:5678
```

Primera vez: n8n pide crear usuario owner. Anotá las credenciales.

> El usuario `tfi_app` que usa el pipeline requiere un paso manual la primera vez
> (inyectar el password del rol). Ver [`sql/README.md`](sql/README.md).

## Demo

Para ver el pipeline funcionando end-to-end sin armar el workflow visual, el
directorio [`demo/`](demo/README.md) incluye un **panel operativo web** y un
**CLI** con trace paso a paso. Ambos ejecutan la misma lógica que los nodos de
n8n y usan cache de IA para no gastar crédito de OpenAI en cada corrida.

```bash
cd demo && npm install
node web/server.mjs   # panel operativo en http://localhost:4000
```

## Estructura

```
flowpedidos/
├── docker-compose.yml      # Stack n8n + postgres + mock-marketplace
├── .env.example            # Plantilla de variables (sin secretos)
├── context.md              # Notas de continuidad entre sesiones de desarrollo
├── sql/                    # DDL del modelo canónico, roles y migraciones
├── n8n-workflows/          # Flujo exportado (JSON) + Code nodes (lib/) y SQL
├── prompts/                # Versionado de prompts para el LLM
├── mocks/                  # Mock-marketplace (fixtures ML) + webhooks de prueba
├── dataset/                # Generador reproducible + 50 pedidos simulados
└── demo/                   # Panel operativo web + CLI del pipeline
```

## Comandos útiles

```bash
docker compose up -d              # Levantar
docker compose down               # Bajar (mantiene datos)
docker compose down -v            # Bajar + borrar volúmenes (¡CUIDADO!)
docker compose logs -f n8n        # Logs en vivo de n8n
docker compose logs -f postgres   # Logs en vivo de postgres
docker compose exec postgres psql -U postgres -d tfi   # Shell SQL
```

> El puerto de Postgres en el host es configurable con `PG_HOST_PORT` (default
> `5433`, para evitar choque con un PostgreSQL local). Internamente sigue siendo
> `5432`, que es por donde se conecta n8n en la red interna `tfi-net`.
