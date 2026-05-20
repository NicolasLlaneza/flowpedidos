#!/usr/bin/env bash
# ============================================================================
# send-webhook.sh
# ----------------------------------------------------------------------------
# Simula que la plataforma de Mercado Libre envía una notificación de webhook
# al endpoint configurado de n8n.
#
# Uso:
#   ./send-webhook.sh <nombre-payload> [endpoint]
#
# Ejemplos:
#   ./send-webhook.sh paid-2235
#   ./send-webhook.sh shipped-2236
#   ./send-webhook.sh duplicate-2235
#   ./send-webhook.sh invalid-missing-resource
#   ./send-webhook.sh paid-2235 http://localhost:5678/webhook-test/ml-order
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYLOAD_NAME="${1:-paid-2235}"
ENDPOINT="${2:-http://localhost:5678/webhook/ml-order}"

PAYLOAD_FILE="$SCRIPT_DIR/webhooks/${PAYLOAD_NAME}.json"

if [[ ! -f "$PAYLOAD_FILE" ]]; then
    echo "ERROR: no existe $PAYLOAD_FILE" >&2
    echo "Payloads disponibles:" >&2
    ls -1 "$SCRIPT_DIR/webhooks/" | sed 's/\.json$//' | sed 's/^/  - /' >&2
    exit 1
fi

echo ">>> POST $ENDPOINT"
echo ">>> Payload: $PAYLOAD_NAME"
echo ">>> Body:"
cat "$PAYLOAD_FILE" | sed 's/^/    /'
echo ""
echo ">>> Respuesta:"

# -i incluye headers, --max-time evita colgarse, -w muestra status final
curl -sS -i \
    --max-time 30 \
    -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "User-Agent: MercadoLibre-Webhook/1.0" \
    -H "X-Signature: mock-signature-not-validated" \
    --data-binary "@$PAYLOAD_FILE" \
    -w "\n\n>>> Status: %{http_code} | Tiempo: %{time_total}s\n"
