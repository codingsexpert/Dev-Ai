/**
 * server/index.js — Express + WebSocket Server Entry Point
 * 
 * FIRST PRINCIPLES:
 * This is the "glue" between:
 *   1. React Dashboard (frontend, port 5173)
 *   2. LangGraph Pipeline (backend logic)
 *   3. Docker Sandbox (containers managed by pipeline)
 * 
 * It provides:
 *   - REST API on /api/* for CRUD operations
 *   - WebSocket on /ws for real-time streaming
 *   - CORS for frontend dev server
 * 
 * STARTUP SEQUENCE:
 *   1. Load env vars
 *   2. Initialize Gemini
 *   3. Start Express + attach WebSocket
 *   4. Ready for frontend connections
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer } from "ws";

import { initGemini } from "../src/utils/gemini.js";
import projectRoutes from "./routes/projects.js";
import { initWebSocket } from "./ws/handler.js";

const PORT = process.env.SERVER_PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const allowedOrigins = FRONTEND_URL.split(",").map((origin) => origin.trim()).filter(Boolean);

// ─── Express App ─────────────────────────────────────────────

const app = express();

// Middleware
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));

// Request logging
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    console.log(`   ${req.method} ${req.path}`);
  }
  next();
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    version: "1.0.0",
    gemini: !!process.env.GEMINI_API_KEY,
    timestamp: Date.now(),
  });
});

// Project routes
app.use("/api/projects", projectRoutes);

// ─── HTTP + WebSocket Server ─────────────────────────────────

const server = createServer(app);

// WebSocket server — shares the same HTTP server
const wss = new WebSocketServer({
  server,
  path: "/ws",
});

initWebSocket(wss);

// ─── Startup ─────────────────────────────────────────────────

async function start() {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║                                                          ║");
  console.log("║   🤖  AI DEV TEAM — Mission Control Server              ║");
  console.log("║   Phase 7: Web Dashboard                                 ║");
  console.log("║                                                          ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("");

  // 1. Initialize Gemini
  try {
    initGemini(process.env.GEMINI_API_KEY);
    console.log(`   ✅ Gemini initialized (model: ${process.env.GEMINI_MODEL || "gemini-2.5-flash"})`);
  } catch (error) {
    console.warn(`   ⚠️  Gemini not available: ${error.message}`);
    console.warn("      Set GEMINI_API_KEY in .env for full functionality");
  }

  // 2. Start server
  server.listen(PORT, () => {
    console.log(`   ✅ REST API:    http://localhost:${PORT}/api`);
    console.log(`   ✅ WebSocket:   ws://localhost:${PORT}/ws`);
    console.log(`   ✅ Frontend:    ${FRONTEND_URL}`);
    console.log("");
    console.log("   Waiting for dashboard connections...");
    console.log("");
  });
}

start().catch((error) => {
  console.error("   ❌ Server failed to start:", error);
  process.exit(1);
});
