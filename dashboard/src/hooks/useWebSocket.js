/**
 * hooks/useWebSocket.js — WebSocket Connection Hook
 * 
 * FIRST PRINCIPLES:
 * A custom React hook that:
 * 1. Connects to ws://server/ws?projectId=xxx
 * 2. Pipes incoming events into the Zustand store
 * 3. Provides a sendMessage function for human input
 * 4. Handles reconnection on disconnect
 * 5. Cleans up on unmount
 * 
 * Usage:
 *   const { sendMessage, disconnect } = useWebSocket(projectId);
 *   // Events automatically flow into useProjectStore
 */

import { useEffect, useRef, useCallback } from "react";
import useProjectStore from "../store/projectStore";

function getWebSocketBaseUrl() {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }

  if (typeof window !== "undefined") {
    const { protocol, host, hostname } = window.location;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
      return `${wsProtocol}//${host}`;
    }
    const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
    return `${wsProtocol}//${host.replace(/^www\./, "")}`;
  }

  return "ws://localhost:3000";
}

const WS_BASE_URL = getWebSocketBaseUrl();
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

export default function useWebSocket(projectId) {
  const wsRef = useRef(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimerRef = useRef(null);

  const setWsConnected = useProjectStore((s) => s.setWsConnected);
  const processEvent = useProjectStore((s) => s.processEvent);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (!projectId) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const url = `${WS_BASE_URL}/ws?projectId=${projectId}`;
    console.log(`[WS] Connecting to ${url}`);

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[WS] Connected");
      setWsConnected(true);
      reconnectCountRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        processEvent(data);
      } catch (e) {
        console.error("[WS] Failed to parse message:", e);
      }
    };

    ws.onclose = (event) => {
      console.log(`[WS] Disconnected (code: ${event.code})`);
      setWsConnected(false);
      wsRef.current = null;

      // Auto-reconnect if not intentional close
      if (
        event.code !== 1000 &&
        reconnectCountRef.current < MAX_RECONNECT_ATTEMPTS
      ) {
        reconnectCountRef.current++;
        console.log(
          `[WS] Reconnecting in ${RECONNECT_DELAY}ms (attempt ${reconnectCountRef.current}/${MAX_RECONNECT_ATTEMPTS})`
        );
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY);
      }
    };

    ws.onerror = (error) => {
      console.error("[WS] Error:", error);
    };
  }, [projectId, setWsConnected, processEvent]);

  // Send a message to the server
  const sendMessage = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    } else {
      console.warn("[WS] Cannot send — not connected");
    }
  }, []);

  // Intentional disconnect
  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }
    reconnectCountRef.current = MAX_RECONNECT_ATTEMPTS; // prevent reconnect
    if (wsRef.current) {
      wsRef.current.close(1000, "User disconnect");
      wsRef.current = null;
    }
    setWsConnected(false);
  }, [setWsConnected]);

  // Connect when projectId changes
  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000, "Component unmount");
      }
    };
  }, [connect]);

  return { sendMessage, disconnect, connect };
}
