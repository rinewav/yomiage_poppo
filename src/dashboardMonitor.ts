import axios from 'axios';
import { COORDINATION_TIMEOUT_MS, DASHBOARD_LOG_LINES, DASHBOARD_REFRESH_MS } from './constants';
import { BotStatus } from './botCoordinator';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const CLEAR_SCREEN = '\x1b[2J';
const HOME = '\x1b[H';

const BOT_PORTS: number[] = (process.env.BOT_PORTS || '31001,31002,31003,31004,31005').split(',').map(Number).filter(Boolean);
const BOT_NAMES = ['1号機', '2号機', '3号機', '4号機', '5号機'];

const BANNER = `
${RED}${BOLD} █   █  ███  █   █  █  ███  ███  ███  ███   ███  ███  ███   ███ ${RESET}
${RED}${BOLD}  █ █  █   █ ██ ██  █ █   █ █    █    █  █ █   █ █  █ █  █ █   █${RESET}
${RED}${BOLD}   █   █   █ █ █ █  █ █████ █ ██ ███  ███  █   █ ███  ███  █   █${RESET}
${RED}${BOLD}   █   █   █ █   █  █ █   █ █  █ █    █    █   █ █    █    █   █${RESET}
${RED}${BOLD}   █    ███  █   █  █ █   █  ███ ███  █     ███  █    █     ███ ${RESET}
${DIM}
     ぽん酢鯖専用読み上げボット - よみあげぽっぽ プロセスダッシュボード${RESET}
`;

interface BotInfo {
  status: BotStatus | null;
  logs: string[];
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

async function fetchBotInfo(port: number): Promise<BotInfo> {
  const info: BotInfo = { status: null, logs: [] };
  try {
    const [statusRes, logsRes] = await Promise.all([
      axios.get<BotStatus>(`http://localhost:${port}/status`, { timeout: COORDINATION_TIMEOUT_MS }),
      axios.get<string[]>(`http://localhost:${port}/logs`, { timeout: COORDINATION_TIMEOUT_MS }),
    ]);
    info.status = statusRes.data;
    info.logs = logsRes.data || [];
  } catch {}
  return info;
}

function renderStatusDot(status: BotStatus | null): string {
  if (!status) return `${RED}✗ Offline${RESET}`;
  if (status.joining) return `${YELLOW}⟳ Joining${RESET}`;
  if (status.busy) return `${YELLOW}● Busy${RESET}`;
  return `${GREEN}● Ready${RESET}`;
}

function renderAll(botInfos: BotInfo[]): string {
  const lines: string[] = [];
  const w = 63;

  lines.push('');
  lines.push(BANNER);
  lines.push('');

  const fleetLine = BOT_PORTS.map((_, i) => `${BOLD}${BOT_NAMES[i]}${RESET}`).join('   ');
  lines.push(`   ${fleetLine}`);
  lines.push('');

  const statusLine = BOT_PORTS.map((_, i) => {
    const label = BOT_NAMES[i];
    return `${label} ${renderStatusDot(botInfos[i]?.status ?? null)}`;
  }).join('  ');

  lines.push(` ${CYAN}┌─ Fleet Status ${'─'.repeat(w - 16)}┐${RESET}`);
  lines.push(` │  ${statusLine}${RESET}`);
  lines.push(` ${CYAN}└${'─'.repeat(w + 1)}┘${RESET}`);
  lines.push('');

  for (let i = 0; i < 5; i++) {
    const info = botInfos[i];
    const label = BOT_NAMES[i];
    const online = info?.status !== null;

    lines.push(` ${CYAN}├─ ${BOLD}${label}${RESET}${CYAN} ${'─'.repeat(w - 6 - stripAnsi(label).length)}┤${RESET}`);

    if (online) {
      const logs = info?.logs || [];
      if (logs.length === 0) {
        lines.push(` ${DIM}│  (no recent logs)${RESET}`);
      }
      for (const log of logs.slice(-DASHBOARD_LOG_LINES)) {
        const cleanLog = stripAnsi(log);
        const truncated = cleanLog.length > w - 3 ? cleanLog.slice(0, w - 3) + '…' : cleanLog;
        lines.push(` ${DIM}│${RESET} ${truncated}`);
      }
    } else {
      lines.push(` ${DIM}│  ${RED}(offline — waiting...)${RESET}`);
    }
  }

  lines.push(` ${CYAN}╰${'─'.repeat(w + 1)}╯${RESET}`);
  lines.push('');
  lines.push(` ${DIM}Refreshing every ${DASHBOARD_REFRESH_MS / 1000}s  •  Ctrl+C to stop${RESET}`);

  return lines.join('\n');
}

async function main(): Promise<void> {
  if (!process.stdout.isTTY) {
    console.error('Dashboard requires a TTY terminal.');
    process.exit(1);
  }

  const botInfos = await Promise.all(BOT_PORTS.map((port) => fetchBotInfo(port)));
  process.stdout.write(CLEAR_SCREEN + HOME);
  process.stdout.write(renderAll(botInfos) + '\n');

  setInterval(async () => {
    const botInfos = await Promise.all(BOT_PORTS.map((port) => fetchBotInfo(port)));
    process.stdout.write(CLEAR_SCREEN + HOME);
    process.stdout.write(renderAll(botInfos) + '\n');
  }, DASHBOARD_REFRESH_MS);

  process.on('SIGINT', () => {
    process.stdout.write(CLEAR_SCREEN + HOME);
    process.stdout.write(`${GREEN}Dashboard stopped.${RESET}\n`);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Dashboard error:', err);
  process.exit(1);
});
