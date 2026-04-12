/**
 * ws/handler.js — WebSocket Connection Handler
 * 
 * FIRST PRINCIPLES:
 * Each WebSocket connection is tied to a project.
 * The client connects to ws://server/ws?projectId=xxx
 * 
 * Server → Client messages (events from graph execution):
 *   { type: "node_complete", node: "pmAgent", data: {...} }
 *   { type: "human_input_needed", inputType: "pm_clarification", questions: [...] }
 *   { type: "token_update", usage: {...} }
 *   { type: "run_complete", finalState: {...} }
 * 
 * Client → Server messages (user interactions):
 *   { type: "human_response", inputType: "pm_clarification", data: {...} }
 *   { type: "cancel" }
 * 
 * MULTIPLE CLIENTS:
 * Multiple browser tabs can watch the same project.
 * We maintain a Set of WebSocket connections per projectId.
 */

import { provideHumanInput, cancelProject, getRunStatus } from "../services/graphRunner.js";

/**
 * Map: projectId → Set<WebSocket>
 * Multiple clients can observe the same project run
 */
const projectClients = new Map();

/**
 * Initialize WebSocket handling on the HTTP server
 * Uses the 'ws' library's WebSocketServer
 * 
 * @param {WebSocketServer} wss - The ws server instance
 */
export function initWebSocket(wss) {
  wss.on("connection", (ws, req) => {
    // Extract projectId from query string
    const url = new URL(req.url, `http://${req.headers.host}`);
    const projectId = url.searchParams.get("projectId");

    if (!projectId) {
      ws.send(JSON.stringify({ type: "error", message: "Missing projectId query param" }));
      ws.close();
      return;
    }

    // Register this client for the project
    if (!projectClients.has(projectId)) {
      projectClients.set(projectId, new Set());
    }
    projectClients.get(projectId).add(ws);

    console.log(`   🔌 WS connected: project=${projectId} (${projectClients.get(projectId).size} clients)`);

    // Send current status if run is active
    const status = getRunStatus(projectId);
    if (status) {
      ws.send(JSON.stringify({ type: "status", ...status, timestamp: Date.now() }));
    }

    // ─── Handle incoming messages from client ─────────────────
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        handleClientMessage(projectId, msg, ws);
      } catch (e) {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      }
    });

    // ─── Handle disconnect ────────────────────────────────────
    ws.on("close", () => {
      const clients = projectClients.get(projectId);
      if (clients) {
        clients.delete(ws);
        if (clients.size === 0) {
          projectClients.delete(projectId);
        }
      }
      console.log(`   🔌 WS disconnected: project=${projectId}`);
    });

    ws.on("error", (err) => {
      console.error(`   ❌ WS error for ${projectId}:`, err.message);
    });
  });
}

/**
 * Handle messages from the frontend client
 */
function handleClientMessage(projectId, msg, ws) {
  switch (msg.type) {
    case "human_response": {
      // User answered PM questions or escalation prompt
      const delivered = provideHumanInput(projectId, msg.data);
      ws.send(JSON.stringify({
        type: "ack",
        message: delivered ? "Input delivered to agent" : "No pending input request",
        timestamp: Date.now(),
      }));
      break;
    }

    case "cancel": {
      const cancelled = cancelProject(projectId);
      ws.send(JSON.stringify({
        type: "ack",
        message: cancelled ? "Project cancelled" : "No active run found",
        timestamp: Date.now(),
      }));
      break;
    }

    case "ping": {
      ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
      break;
    }

    default:
      ws.send(JSON.stringify({
        type: "error",
        message: `Unknown message type: ${msg.type}`,
      }));
  }
}

/**
 * Broadcast an event to all clients watching a project
 * This is called by the graphRunner's emit function
 * 
 * @param {string} projectId
 * @param {object} event - The event to broadcast
 */
export function broadcastToProject(projectId, event) {
  const clients = projectClients.get(projectId);
  if (!clients || clients.size === 0) return;

  const payload = JSON.stringify(event);

  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}

/**
 * Get count of connected clients for a project
 */
export function getClientCount(projectId) {
  return projectClients.get(projectId)?.size || 0;
}
