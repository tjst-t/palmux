#!/bin/bash
set -euo pipefail

HOST="${1:?Usage: $0 <host|IP> [port]}"
PORT="${2:-8443}"

CERT_DIR="/tmp/palmux-dev-certs"
CERT_FILE="${CERT_DIR}/palmux-${HOST}.crt"
KEY_FILE="${CERT_DIR}/palmux-${HOST}.key"

# ビルド
echo "==> Building..."
make build

# 証明書を毎回新規生成（古い証明書による接続エラーを防ぐため常に上書き）
echo "==> Generating self-signed certificate for ${HOST}..."
mkdir -p "$CERT_DIR"

# ホスト名が IP アドレスか判定
if echo "$HOST" | grep -qP '^\d+\.\d+\.\d+\.\d+$'; then
  SAN="IP:${HOST}"
else
  SAN="DNS:${HOST}"
fi

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -keyout "$KEY_FILE" -out "$CERT_FILE" -days 1 -nodes \
  -subj "/CN=${HOST}" \
  -addext "subjectAltName=${SAN}" 2>/dev/null

echo "    cert: ${CERT_FILE}"
echo "    key:  ${KEY_FILE}"

echo "==> Starting Palmux on https://${HOST}:${PORT}"
exec ./palmux --tls-cert "$CERT_FILE" --tls-key "$KEY_FILE" --host 0.0.0.0 --port "${PORT}"
