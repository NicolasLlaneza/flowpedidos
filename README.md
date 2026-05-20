# TFI — Arquitectura de integración multicanal para PyMEs e-commerce

Trabajo Final Integrador, Tecnicatura Universitaria en Programación, UTN-FRM, 2026.

**Autores**: Nicolás Llaneza, Miguel Barrera Oltra, Sabrina Moreira
**Director**: Mag. Ing. Alberto Cortez

## Stack

- **n8n** — orquestador low-code de flujos
- **PostgreSQL** — persistencia del modelo de datos canónico
- **OpenAI GPT-4o-mini** — generación de mensajes contextualizados (modelo principal)
- **Anthropic Claude Haiku** — modelo comparativo (Fase 6)

## Prerequisitos

- Docker Desktop + Docker Compose v2
- API key de OpenAI (https://platform.openai.com/api-keys)
- API key de Anthropic (https://console.anthropic.com/) — opcional, solo Fase 6

## Quickstart

```bash
# 1. Clonar y entrar
git clone <repo> Tesis-TFI && cd Tesis-TFI

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

## Estructura

```
Tesis-TFI/
├── docker-compose.yml      # Stack n8n + postgres
├── .env.example            # Plantilla de variables (sin secretos)
├── sql/                    # DDL del modelo canónico, migrations
├── n8n-workflows/          # Flujos exportados (JSON)
├── prompts/                # Versionado de prompts para el LLM
├── dataset/                # 50 pedidos simulados + datos reales (gitignored)
└── docs/                   # Notas de implementación, decisiones técnicas
```

## Comandos útiles

```bash
docker compose up -d              # Levantar
docker compose down               # Bajar (mantiene datos)
docker compose down -v            # Bajar + borrar volúmenes (¡CUIDADO!)
docker compose logs -f n8n        # Logs en vivo de n8n
docker compose logs -f postgres   # Logs en vivo de postgres
docker compose exec postgres psql -U n8n -d tfi   # Shell SQL
```
