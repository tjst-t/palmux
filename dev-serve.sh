#!/bin/bash
set -euo pipefail

HOST="${1:?Usage: $0 <host|IP> [port]}"
PORT="${2:-8443}"

CERT_DIR="/tmp/palmux-dev-certs"
CERT_FILE="${CERT_DIR}/palmux-${HOST}.crt"
KEY_FILE="${CERT_DIR}/palmux-${HOST}.key"
PID_FILE="/tmp/palmux-dev.pid"
LOG_FILE="/tmp/palmux-dev.log"

# 以前の dev-serve プロセスを停止
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "==> Killing previous palmux process (PID: ${OLD_PID})..."
    kill "$OLD_PID"
    # 終了を待つ（最大5秒）
    for i in $(seq 1 50); do
      kill -0 "$OLD_PID" 2>/dev/null || break
      sleep 0.1
    done
    # まだ生きていれば SIGKILL
    if kill -0 "$OLD_PID" 2>/dev/null; then
      echo "    Process did not exit, sending SIGKILL..."
      kill -9 "$OLD_PID" 2>/dev/null || true
    fi
  fi
  rm -f "$PID_FILE"
fi

# ビルド
echo "==> Building..."
make build

# ホスト名が IP アドレスか判定
if echo "$HOST" | grep -qP '^\d+\.\d+\.\d+\.\d+$'; then
  SAN="IP:${HOST}"
else
  SAN="DNS:${HOST}"
fi

# 証明書が存在しないか期限切れの場合のみ生成
NEED_CERT=false
if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
  NEED_CERT=true
elif ! openssl x509 -checkend 0 -noout -in "$CERT_FILE" 2>/dev/null; then
  echo "==> Certificate expired, regenerating..."
  NEED_CERT=true
fi

if [ "$NEED_CERT" = true ]; then
  echo "==> Generating self-signed certificate for ${HOST}..."
  mkdir -p "$CERT_DIR"

  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
    -keyout "$KEY_FILE" -out "$CERT_FILE" -days 365 -nodes \
    -subj "/CN=${HOST}" \
    -addext "subjectAltName=${SAN}" 2>/dev/null

  echo "    cert: ${CERT_FILE}"
  echo "    key:  ${KEY_FILE}"
else
  echo "==> Using existing certificate for ${HOST} (valid)"
fi

echo "==> Starting Palmux on https://${HOST}:${PORT} (nohup, log: ${LOG_FILE})"
nohup ./palmux --tls-cert "$CERT_FILE" --tls-key "$KEY_FILE" --host 0.0.0.0 --port "${PORT}" \
  > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
echo "    PID: $(cat "$PID_FILE")"
