/**
 * setupSandbox.js — Creates complete Docker environment
 * 
 * Passes the Architect's dbSchema to sandboxManager so that:
 * - Database container starts with correct image
 * - Tables are created from the schema
 * - Backend has DATABASE_URL set
 * - Frontend has VITE_API_URL set
 */

import { createSandbox } from "../utils/sandboxManager.js";

/**
 * Pre-built registry entries for scaffold files.
 * These are DETERMINISTIC — we wrote these files, we know their exports.
 * No LLM needed. Every coder call will see these exact import statements.
 */
function getScaffoldRegistry(dbType) {
  return [
    {
      path: "backend/src/config/db.js",
      defaultExport: dbType === "mongo" ? "mongoose" : null,
      namedExports: dbType === "mongo" ? ["connectDB"] : ["pool", "connectDB"],
      exports: dbType === "mongo" ? ["mongoose", "connectDB"] : ["pool", "connectDB"],
      importStatement: dbType === "mongo"
        ? "import mongoose, { connectDB } from '../config/db.js'"
        : "import { pool, connectDB } from '../config/db.js'",
      interface: dbType === "mongo"
        ? "mongoose: Mongoose instance. connectDB(): async, connects to MongoDB."
        : "pool: pg.Pool instance for queries (pool.query(sql, params)). connectDB(): async, tests connection.",
      updatedAt: Date.now(),
    },
    {
      path: "backend/src/middleware/auth.js",
      defaultExport: null,
      namedExports: ["authenticateToken", "authorizeRole"],
      exports: ["authenticateToken", "authorizeRole"],
      importStatement: "import { authenticateToken, authorizeRole } from '../middleware/auth.js'",
      interface: "authenticateToken: Express middleware, verifies JWT from Authorization Bearer header, sets req.user = { id, email, role }. authorizeRole(...roles): middleware factory, checks req.user.role is in allowed roles.",
      updatedAt: Date.now(),
    },
    {
      path: "backend/src/index.js",
      defaultExport: "app",
      namedExports: [],
      exports: ["app"],
      importStatement: "import app from '../index.js'",
      interface: "Express app instance. Has cors, json middleware, /api/health endpoint. Routes auto-wired by assembly node. Do NOT import this in other backend files.",
      updatedAt: Date.now(),
    },
    {
      path: "frontend/src/utils/api.js",
      defaultExport: "api",
      namedExports: [],
      exports: ["api"],
      importStatement: "import api from '../utils/api'",
      interface: "Axios instance with baseURL from VITE_API_URL. Auto-attaches Bearer token from localStorage. Use: api.get('/todos'), api.post('/auth/login', { email, password })",
      updatedAt: Date.now(),
    },
    {
      path: "frontend/src/main.jsx",
      defaultExport: null,
      namedExports: [],
      exports: [],
      importStatement: "",
      interface: "React entry point. Renders <App /> into #root. Do NOT import this.",
      updatedAt: Date.now(),
    },
    {
      path: "frontend/src/App.jsx",
      defaultExport: "App",
      namedExports: [],
      exports: ["App"],
      importStatement: "import App from '../App'",
      interface: "Root React component with BrowserRouter. Pages auto-wired by assembly node. Do NOT import this in page components.",
      updatedAt: Date.now(),
    },
  ];
}

export async function setupSandboxNode(state) {
  console.log("\n[Setup Sandbox] Creating project workspace...\n");

  const { folderStructure, dependencies, dbSchema } = state.blueprint;

  try {
    const sandboxId = await createSandbox(folderStructure, dependencies, dbSchema);
    const dbType = dependencies?.backend?.dependencies?.mongoose ? "mongo" : "postgres";

    console.log(`\n   Sandbox created: ${sandboxId}`);

    // Seed registry with scaffold file interfaces
    const scaffoldRegistry = getScaffoldRegistry(dbType);
    console.log(`   Registry seeded: ${scaffoldRegistry.length} scaffold files indexed`);

    return {
      sandboxId,
      currentPhase: "sandbox",
      fileRegistry: scaffoldRegistry,
    };
  } catch (error) {
    console.error(`   Sandbox creation failed: ${error.message}`);
    return {
      sandboxId: "",
      error: `Sandbox creation failed: ${error.message}`,
    };
  }
}
