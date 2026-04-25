#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

mkdir -p logs

cleanup() {
    echo ""
    echo "Stopping all bots..."
    jobs -p | xargs kill 2>/dev/null
    wait 2>/dev/null
    echo "All bots stopped."
}
trap cleanup EXIT INT TERM

while true; do npx tsx src/index.ts >> logs/1gou.log 2>&1; echo "[1号機] 終了 → 5秒後に再起動"; sleep 5; done &
while true; do npx tsx src/index2gou.ts >> logs/2gou.log 2>&1; echo "[2号機] 終了 → 5秒後に再起動"; sleep 5; done &
while true; do npx tsx src/index3gou.ts >> logs/3gou.log 2>&1; echo "[3号機] 終了 → 5秒後に再起動"; sleep 5; done &
while true; do npx tsx src/index4gou.ts >> logs/4gou.log 2>&1; echo "[4号機] 終了 → 5秒後に再起動"; sleep 5; done &
while true; do npx tsx src/index5gou.ts >> logs/5gou.log 2>&1; echo "[5号機] 終了 → 5秒後に再起動"; sleep 5; done &

sleep 3

BOT_PORTS=31001,31002,31003,31004,31005 npx tsx src/dashboardMonitor.ts
