import { DASHBOARD_LOG_LINES, DASHBOARD_REFRESH_MS } from './constants';
import { queryAllBots, BotStatus } from './botCoordinator';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';
const MOVE_UP = (n: number) => `\x1b[${n}A`;
const CLEAR_LINE = '\x1b[2K';
const SAVE_CURSOR = '\x1b[s';
const RESTORE_CURSOR = '\x1b[u';

const BANNER = `
${RED}${BOLD} █   █  ███  █   █  █  ███  ███  ███  ███   ███  ███  ███   ███ ${RESET}
${RED}${BOLD}  █ █  █   █ ██ ██  █ █   █ █    █    █  █ █   █ █  █ █  █ █   █${RESET}
${RED}${BOLD}   █   █   █ █ █ █  █ █████ █ ██ ███  ███  █   █ ███  ███  █   █${RESET}
${RED}${BOLD}   █   █   █ █   █  █ █   █ █  █ █    █    █   █ █    █    █   █${RESET}
${RED}${BOLD}   █    ███  █   █  █ █   █  ███ ███  █     ███  █    █     ███ ${RESET}
${DIM}
     ぽん酢鯖専用読み上げボット - よみあげぽっぽ プロセスダッシュボード${RESET}
`;

const logBuffer: string[] = [];
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

let dashboardActive = false;
let logAreaStartRow = 0;
let totalDashboardRows = 0;
let healthInterval: NodeJS.Timeout | null = null;

function padOrTruncate(str: string, len: number): string {
  const visible = stripAnsi(str);
  if (visible.length > len) return str.slice(0, len);
  return str + ' '.repeat(len - visible.length);
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

function pushLog(level: string, ...args: any[]): void {
  const ts = new Date().toLocaleTimeString('ja-JP', { hour12: false });
  const body = args.map((a) => (typeof a === 'string' ? a : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  let prefix = '';
  if (level === 'error') prefix = `${RED}ERR${RESET}`;
  else if (level === 'warn') prefix = `${YELLOW}WRN${RESET}`;
  else prefix = `${DIM}${ts}${RESET}`;

  const line = `${prefix} ${body}`;
  logBuffer.push(line);
  if (logBuffer.length > DASHBOARD_LOG_LINES) logBuffer.shift();

  if (dashboardActive) {
    redrawLogs();
  } else {
    originalLog.call(console, ...args);
  }
}

function redrawLogs(): void {
  if (!dashboardActive) return;

  process.stdout.write(MOVE_UP(DASHBOARD_LOG_LINES));
  for (let i = 0; i < DASHBOARD_LOG_LINES; i++) {
    process.stdout.write(CLEAR_LINE + '\r');
    if (i < logBuffer.length) {
      process.stdout.write(` ${DIM}│${RESET} ${logBuffer[i]}\n`);
    } else {
      process.stdout.write(` ${DIM}│${RESET}\n`);
    }
  }
}

function renderBotStatus(botNumber: number, status: BotStatus | null): string {
  const label = `${botNumber}号機`;
  if (!status) {
    return `${DIM}${label} ${RED}✗ Offline${RESET}    `;
  }
  if (status.busy || status.joining) {
    return `${label} ${YELLOW}● Busy${RESET}     `;
  }
  return `${label} ${GREEN}● Ready${RESET}    `;
}

function buildHealthGrid(myBotNumber: number, statuses: (BotStatus | null)[]): string {
  const line1 = statuses.slice(0, 3).map((s, i) => renderBotStatus(i + 1, s)).join(' ');
  const line2 = statuses.slice(3).map((s, i) => renderBotStatus(i + 4, s)).join(' ');

  const width = 61;
  const top = `${CYAN} ╭─ Fleet Status ${'─'.repeat(Math.max(0, width - 16))}╮${RESET}`;
  const row1 = ` │ ${padOrTruncate(line1, width - 2)} │`;
  const row2 = ` │ ${padOrTruncate(line2, width - 2)} │`;
  const sep = `${CYAN} ╰${'─'.repeat(width)}╯${RESET}`;
  const logHeader = ` ${DIM}├─ Recent Logs ${'─'.repeat(Math.max(0, width - 14))}┤${RESET}`;

  return [top, row1, row2, sep, logHeader].join('\n');
}

export function initDashboard(botNumber: number, allPorts: number[], getBusy?: () => boolean): void {
  if (!process.stdout.isTTY) {
    originalLog.call(console, `[Dashboard] TTY not detected, using plain logging.`);
    return;
  }

  dashboardActive = true;

  const placeholderStatuses: (BotStatus | null)[] = new Array(5).fill(null);
  placeholderStatuses[botNumber - 1] = { botNumber, busy: false, joining: false };

  process.stdout.write(BANNER + '\n');
  process.stdout.write(buildHealthGrid(botNumber, placeholderStatuses) + '\n');

  for (let i = 0; i < DASHBOARD_LOG_LINES; i++) {
    process.stdout.write(` ${DIM}│${RESET}\n`);
  }

  console.log = (...args: any[]) => pushLog('log', ...args);
  console.error = (...args: any[]) => pushLog('error', ...args);
  console.warn = (...args: any[]) => pushLog('warn', ...args);

  if (allPorts.length > 0 && allPorts[botNumber - 1]) {
    healthInterval = setInterval(async () => {
      const myPort = allPorts[botNumber - 1] || 0;
      const otherStatuses = await queryAllBots(allPorts, myPort);

      const statuses: (BotStatus | null)[] = new Array(5).fill(null);
      statuses[botNumber - 1] = {
        botNumber,
        busy: getBusy ? getBusy() : false,
        joining: false,
      };
      for (const s of otherStatuses) {
        statuses[s.botNumber - 1] = s;
      }

      const updated = buildHealthGrid(botNumber, statuses);
      const totalLines = countLines(updated);

      process.stdout.write(MOVE_UP(DASHBOARD_LOG_LINES + totalLines));
      process.stdout.write(updated + '\n');
      for (let i = 0; i < DASHBOARD_LOG_LINES; i++) {
        process.stdout.write(CLEAR_LINE + '\r');
        if (i < logBuffer.length) {
          process.stdout.write(` ${DIM}│${RESET} ${logBuffer[i]}\n`);
        } else {
          process.stdout.write(` ${DIM}│${RESET}\n`);
        }
      }
    }, DASHBOARD_REFRESH_MS);
  }

  originalLog.call(console, `[Dashboard] ${botNumber}号機 TUI initialized`);
}

function countLines(str: string): number {
  return str.split('\n').length;
}

export function getLogBuffer(): string[] {
  return [...logBuffer];
}

export function shutdownDashboard(): void {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
  if (dashboardActive) {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    dashboardActive = false;
  }
}
