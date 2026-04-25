import http from 'http';
import axios from 'axios';
import { COORDINATION_TIMEOUT_MS } from './constants';

export interface BotStatus {
  botNumber: number;
  busy: boolean;
  joining: boolean;
}

export function startCoordinatorServer(
  port: number,
  getStatus: () => BotStatus,
  getLogs?: () => string[]
): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/status') {
      const status = getStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }
    if (req.method === 'GET' && req.url === '/logs') {
      const logs = getLogs ? getLogs() : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(logs));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(port, () => {
    console.log(`[Coordinator] HTTP server listening on port ${port}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Coordinator] Port ${port} is already in use. Is another instance running?`);
    } else {
      console.error(`[Coordinator] Server error:`, err);
    }
  });

  return server;
}

export async function queryAllBots(
  allPorts: number[],
  excludePort: number,
  timeoutMs: number = COORDINATION_TIMEOUT_MS
): Promise<BotStatus[]> {
  const otherPorts = allPorts.filter((p) => p !== excludePort);

  const results = await Promise.allSettled(
    otherPorts.map((port) =>
      axios.get<BotStatus>(`http://localhost:${port}/status`, { timeout: timeoutMs })
        .then((res) => res.data)
    )
  );

  const statuses: BotStatus[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      statuses.push(r.value);
    }
  }
  return statuses;
}

export async function queryBotLogs(
  port: number,
  timeoutMs: number = COORDINATION_TIMEOUT_MS
): Promise<string[]> {
  try {
    const res = await axios.get<string[]>(`http://localhost:${port}/logs`, { timeout: timeoutMs });
    return res.data;
  } catch {
    return [];
  }
}

export function findLowestFreeBot(
  myStatus: BotStatus,
  otherStatuses: BotStatus[]
): number | null {
  const freeBots: { botNumber: number }[] = [];

  const iAmFree = !myStatus.busy && !myStatus.joining;
  if (iAmFree) {
    freeBots.push({ botNumber: myStatus.botNumber });
  }

  for (const s of otherStatuses) {
    if (!s.busy && !s.joining) {
      freeBots.push({ botNumber: s.botNumber });
    }
  }

  if (freeBots.length === 0) return null;
  return Math.min(...freeBots.map((b) => b.botNumber));
}
