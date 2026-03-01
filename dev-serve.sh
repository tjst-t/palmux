#!/bin/bash
set -euo pipefail

PID_FILE="/tmp/palmux-dev.pid"
LOG_FILE="/tmp/palmux-dev.log"
PORTMAN_ENV="/tmp/palmux-portman.env"

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

# portman でポートを取得
echo "==> Leasing port via portman..."
portman env --name palmux --expose --output "$PORTMAN_ENV"
source "$PORTMAN_ENV"
PORT="$PALMUX_PORT"
echo "    Port: ${PORT}"

echo "==> Starting Palmux on port ${PORT} (nohup, log: ${LOG_FILE})"
nohup ./palmux --host 0.0.0.0 --port "${PORT}" \
  > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
echo "    PID: $(cat "$PID_FILE")"
