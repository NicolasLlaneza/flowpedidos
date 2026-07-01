#!/usr/bin/env bash
# ============================================================================
# send-wc-webhook.sh
# ----------------------------------------------------------------------------
# Simula que WooCommerce envía una notificación de webhook a n8n, firmándola
# con HMAC-SHA256 igual que lo hace la plataforma real (header
# X-WC-Webhook-Signature). Sirve para probar la rama WooCommerce del pipeline
# sin tener que crear un pedido real en la tienda.
#
# El secret se toma de (en este orden): $WC_WEBHOOK_SECRET del entorno → del
# archivo .env de la raíz → vacío (firma no válida, útil para probar el rechazo).
#
# Uso:
#   ./send-wc-webhook.sh [nombre-payload] [endpoint]
#
# Ejemplos:
#   ./send-wc-webhook.sh                       # wc-order-processing al webhook prod
#   ./send-wc-webhook.sh wc-order-processing http://localhost:5678/webhook-test/wc-order
#   WC_WEBHOOK_SECRET=otro ./send-wc-webhook.sh
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PAYLOAD_NAME="${1:-wc-order-processing}"
ENDPOINT="${2:-http://localhost:5678/webhook/wc-order}"

PAYLOAD_FILE="$SCRIPT_DIR/webhooks/${PAYLOAD_NAME}.json"

if [[ ! -f "$PAYLOAD_FILE" ]]; then
    echo "ERROR: no existe $PAYLOAD_FILE" >&2
    exit 1
fi

# Resolver el secret: entorno → .env → vacío
SECRET="${WC_WEBHOOK_SECRET:-}"
if [[ -z "$SECRET" && -f "$ROOT_DIR/.env" ]]; then
    SECRET="$(grep -E '^WC_WEBHOOK_SECRET=' "$ROOT_DIR/.env" | head -1 | cut -d= -f2- || true)"
fi

if [[ -z "$SECRET" ]]; then
    echo ">>> AVISO: sin WC_WEBHOOK_SECRET → la firma no va a validar (probás el rechazo)."
    SIGNATURE="firma-invalida-sin-secret"
else
    # HMAC-SHA256 del body crudo, en base64 (idéntico a lo que hace WooCommerce)
    SIGNATURE="$(openssl dgst -sha256 -hmac "$SECRET" -binary < "$PAYLOAD_FILE" | openssl base64 -A)"
fi

echo ">>> POST $ENDPOINT"
echo ">>> Payload: $PAYLOAD_NAME"
echo ">>> Firma HMAC (X-WC-Webhook-Signature): $SIGNATURE"
echo ">>> Respuesta:"

curl -sS -i \
    --max-time 30 \
    -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "User-Agent: WooCommerce/8.0 Hookshot" \
    -H "X-WC-Webhook-Source: http://localhost:8080/" \
    -H "X-WC-Webhook-Topic: order.created" \
    -H "X-WC-Webhook-Resource: order" \
    -H "X-WC-Webhook-Event: created" \
    -H "X-WC-Webhook-Signature: ${SIGNATURE}" \
    --data-binary "@$PAYLOAD_FILE" \
    -w "\n\n>>> Status: %{http_code} | Tiempo: %{time_total}s\n"
