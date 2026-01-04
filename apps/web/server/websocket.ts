import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { parse } from 'url';
import { verifyToken } from './auth';
import { redis } from './redis';
import { logger } from './logger';

// ============ TYPES ============
type AuthenticatedWebSocket = WebSocket & {
  userId?: string;
  organizationId?: string;
  projectId?: string;
  isAlive: boolean;
}

interface WSMessage {
  type: 'LOG' | 'JOB_UPDATE' | 'STATS_UPDATE' | 'PING';
  payload: any;
}

// ============ CONNECTION STORE ============
const connections = new Map<string, Set<AuthenticatedWebSocket>>();

// ============ WEBSOCKET SERVER ============
export function createWebSocketServer(server: any): WebSocketServer {
  const wss = new WebSocketServer({ 
    server,
    path: '/ws',
  });
  
  // Heartbeat interval
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const client = ws as AuthenticatedWebSocket;
      if (!client.isAlive) {
        logger.debug({ userId: client.userId }, 'Terminating inactive WebSocket');
        return client.terminate();
      }
      client.isAlive = false;
      client.ping();
    });
  }, 30000);
  
  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });
  
  wss.on('connection', async (ws: WebSocket, request: IncomingMessage) => {
    const authenticatedWs = ws as AuthenticatedWebSocket;
    authenticatedWs.isAlive = true;
    
    authenticatedWs.on('pong', () => {
      authenticatedWs.isAlive = true;
    });
    
    try {
      // Parse URL and extract project ID
      const { pathname, query } = parse(request.url || '', true);
      const pathParts = pathname?.split('/').filter(Boolean) || [];
      
      // Expected path: /ws/jobs/:projectId
      if (pathParts[0] !== 'jobs' || !pathParts[1]) {
        authenticatedWs.close(4000, 'Invalid path');
        return;
      }
      
      const projectId = pathParts[1];
      const token = query.token as string;
      
      // Verify authentication
      if (!token) {
        authenticatedWs.close(4001, 'Authentication required');
        return;
      }
      
      const user = await verifyToken(token);
      if (!user) {
        authenticatedWs.close(4001, 'Invalid token');
        return;
      }
      
      // Store connection info
      authenticatedWs.userId = user.id;
      authenticatedWs.organizationId = user.organizationId;
      authenticatedWs.projectId = projectId;
      
      // Add to connections map
      const key = `${user.organizationId}:${projectId}`;
      if (!connections.has(key)) {
        connections.set(key, new Set());
      }
      connections.get(key)!.add(authenticatedWs);
      
      logger.info({ userId: user.id, projectId }, 'WebSocket connected');
      
      // Send initial connection confirmation
      authenticatedWs.send(JSON.stringify({
        type: 'CONNECTED',
        payload: { projectId, userId: user.id },
      }));
      
      // Handle incoming messages
      authenticatedWs.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          handleClientMessage(authenticatedWs, message);
        } catch (e) {
          logger.warn({ error: e }, 'Invalid WebSocket message');
        }
      });
      
      // Handle disconnect
      authenticatedWs.on('close', () => {
        connections.get(key)?.delete(authenticatedWs);
        if (connections.get(key)?.size === 0) {
          connections.delete(key);
        }
        logger.info({ userId: user.id, projectId }, 'WebSocket disconnected');
      });
      
    } catch (error) {
      logger.error({ error }, 'WebSocket connection error');
      authenticatedWs.close(4500, 'Internal error');
    }
  });
  
  // Subscribe to Redis pub/sub for cross-instance communication
  subscribeToRedis();
  
  return wss;
}

// ============ HANDLE CLIENT MESSAGES ============
function handleClientMessage(ws: AuthenticatedWebSocket, message: any) {
  switch (message.type) {
    case 'PING':
      ws.send(JSON.stringify({ type: 'PONG', payload: { timestamp: Date.now() } }));
      break;
    case 'SUBSCRIBE':
      // Client wants to subscribe to specific events
      // Already handled by connection to specific project
      break;
    default:
      logger.debug({ type: message.type }, 'Unknown message type');
  }
}

// ============ BROADCAST TO PROJECT ============
export function broadcastToProject(
  organizationId: string, 
  projectId: string, 
  message: WSMessage
): void {
  const key = `${organizationId}:${projectId}`;
  const projectConnections = connections.get(key);
  
  if (!projectConnections || projectConnections.size === 0) {
    return;
  }
  
  const messageStr = JSON.stringify(message);
  
  projectConnections.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(messageStr);
    }
  });
  
  // Also publish to Redis for other server instances
  redis.publish(`ws:${key}`, messageStr);
}

// ============ BROADCAST LOG ENTRY ============
export function broadcastLog(
  organizationId: string,
  projectId: string,
  log: {
    id: string;
    timestamp: string;
    level: 'info' | 'warn' | 'error' | 'success';
    message: string;
    module: string;
  }
): void {
  broadcastToProject(organizationId, projectId, {
    type: 'LOG',
    payload: log,
  });
}

// ============ BROADCAST JOB UPDATE ============
export function broadcastJobUpdate(
  organizationId: string,
  projectId: string,
  job: {
    id: string;
    type: string;
    status: string;
    progress: number;
    processedItems?: number;
    totalItems?: number;
  }
): void {
  broadcastToProject(organizationId, projectId, {
    type: 'JOB_UPDATE',
    payload: job,
  });
}

// ============ REDIS PUB/SUB ============
async function subscribeToRedis(): Promise<void> {
  const subscriber = redis.duplicate();
  await subscriber.connect();
  
  await subscriber.pSubscribe('ws:*', (message, channel) => {
    try {
      const key = channel.replace('ws:', '');
      const projectConnections = connections.get(key);
      
      if (projectConnections) {
        projectConnections.forEach((ws) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
          }
        });
      }
    } catch (e) {
      logger.error({ error: e }, 'Redis pub/sub error');
    }
  });
}

// ============ GET CONNECTION STATS ============
export function getConnectionStats(): {
  totalConnections: number;
  connectionsByProject: Record<string, number>;
} {
  let total = 0;
  const byProject: Record<string, number> = {};
  
  connections.forEach((sockets, key) => {
    const count = sockets.size;
    total += count;
    byProject[key] = count;
  });
  
  return {
    totalConnections: total,
    connectionsByProject: byProject,
  };
}