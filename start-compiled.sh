#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -d "dist" ]; then
    echo "Error: dist/ not found. Run 'npm run build' first."
    exit 1
fi

mkdir -p logs

cleanup() {
    echo ""
    echo "Stopping all bots..."
    jobs -p | xargs kill 2>/dev/null
    wait 2>/dev/null
    echo "All bots stopped."
}
trap cleanup EXIT INT TERM

while true; do node dist/index.js >> logs/1gou.log 2>&1; echo "[1号機] 終了 → 5秒後に再起動"; sleep 5; done &
while true; do node dist/index2gou.js >> logs/2gou.log 2>&1; echo "[2号機] 終了 → 5秒後に再起動"; sleep 5; done &
while true; do node dist/index3gou.js >> logs/3gou.log 2>&1; echo "[3号機] 終了 → 5秒後に再起動"; sleep 5; done &
while true; do node dist/index4gou.js >> logs/4gou.log 2>&1; echo "[4号機] 終了 → 5秒後に再起動"; sleep 5; done &
while true; do node dist/index5gou.js >> logs/5gou.log 2>&1; echo "[5号機] 終了 → 5秒後に再起動"; sleep 5; done &

sleep 3

BOT_PORTS=31001,31002,31003,31004,31005 node dist/dashboardMonitor.js
