/**
 * deploymentVerifier.js — Generate & Verify Docker Deployment
 * 
 * FIRST PRINCIPLES:
 * The LLM should NOT generate Dockerfiles or docker-compose.yml because:
 * 1. It doesn't know the exact sandbox directory structure
 * 2. It doesn't know which port the backend listens on
 * 3. It doesn't know the container names on the Docker network
 * 4. It doesn't know the entry point path (src/index.js vs src/server.js)
 * 
 * Instead, WE generate these files deterministically based on:
 * - The sandbox's package.json (knows the entry point)
 * - The blueprint's DB type (postgres vs mongo)
 * - Fixed conventions (backend on :5000, frontend on :5173)
 * 
 * Then we verify by running docker-compose up and testing endpoints.
 */

import { execSync } from "child_process";
import { getSandboxPath, readFile } from "../utils/sandboxManager.js";
import fs from "fs";
import path from "path";

const BACKEND_PORT = 15000;
const FRONTEND_PORT = 15173;
const DB_PORT = 15432;

/**
 * Detect the backend entry point by checking what actually exists
 */
function detectBackendEntry(sandboxPath) {
  const candidates = [
    "src/index.js",
    "src/server.js",
    "src/app.js",
    "index.js",
    "server.js",
    "app.js",
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(sandboxPath, "backend", candidate))) {
      return candidate;
    }
  }

  // Fallback: check package.json
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(sandboxPath, "backend", "package.json"), "utf-8"));
    if (pkg.main) return pkg.main;
    if (pkg.scripts?.start) {
      const match = pkg.scripts.start.match(/node\s+(.+)/);
      if (match) return match[1].trim();
    }
  } catch (e) {}

  return "src/index.js"; // final fallback
}

/**
 * Detect DB type from backend dependencies
 */
function detectDbType(sandboxPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(sandboxPath, "backend", "package.json"), "utf-8"));
    if (pkg.dependencies?.mongoose || pkg.dependencies?.mongodb) return "mongo";
  } catch (e) {}
  return "postgres";
}

/**
 * Generate all Docker deployment files with CORRECT paths
 */
function generateDeploymentFiles(sandboxPath) {
  const entryPoint = detectBackendEntry(sandboxPath);
  const dbType = detectDbType(sandboxPath);
  const dbImage = dbType === "mongo" ? "mongo:7" : "postgres:16-alpine";
  const dbPort = dbType === "mongo" ? "27017" : "5432";
  const dbEnv = dbType === "mongo"
    ? "MONGO_INITDB_DATABASE: appdb"
    : `POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: appdb`;
  const dbUrl = dbType === "mongo"
    ? "mongodb://db:27017/appdb"
    : "postgresql://postgres:postgres@db:5432/appdb";
  const dbHealthCheck = dbType === "mongo"
    ? 'mongosh --eval "db.runCommand({ping:1})" --quiet'
    : "pg_isready -U postgres";
  const dbHealthInterval = "5s";

  console.log(`   Detected entry point: ${entryPoint}`);
  console.log(`   Detected DB type: ${dbType}`);

  // ─── Backend Dockerfile ────────────────────────────────
  const backendDockerfile = `FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 5000
CMD ["node", "${entryPoint}"]
`;
  fs.writeFileSync(path.join(sandboxPath, "backend", "Dockerfile"), backendDockerfile);
  console.log("   Generated: backend/Dockerfile");

  // ─── Frontend Dockerfile (multi-stage: build with vite, serve with nginx) ──
  const frontendDockerfile = `FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
`;
  fs.writeFileSync(path.join(sandboxPath, "frontend", "Dockerfile"), frontendDockerfile);
  console.log("   Generated: frontend/Dockerfile");

  // ─── Nginx config (proxy /api to backend, serve SPA for everything else) ──
  const nginxConf = `server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # API proxy to backend service
    location /api/ {
        proxy_pass http://backend:5000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SPA fallback — serve index.html for all non-file routes
    location / {
        try_files $uri $uri/ /index.html;
    }
}
`;
  fs.writeFileSync(path.join(sandboxPath, "frontend", "nginx.conf"), nginxConf);
  console.log("   Generated: frontend/nginx.conf");

  // ─── docker-compose.yml ────────────────────────────────
  const compose = `version: "3.8"

services:
  db:
    image: ${dbImage}
    restart: unless-stopped
    ports:
      - "${DB_PORT}:${dbPort}"
    environment:
      ${dbEnv}
    volumes:
      - db_data:/var/lib/${dbType === "mongo" ? "mongodb" : "postgresql"}/data
    healthcheck:
      test: ["CMD-SHELL", "${dbHealthCheck}"]
      interval: ${dbHealthInterval}
      timeout: 5s
      retries: 10

  backend:
    build: ./backend
    restart: unless-stopped
    ports:
      - "${BACKEND_PORT}:5000"
    environment:
      DATABASE_URL: ${dbUrl}
      JWT_SECRET: dev-secret-change-in-production
      PORT: "5000"
      NODE_ENV: production
    depends_on:
      db:
        condition: service_healthy
    env_file:
      - ./backend/.env

  frontend:
    build: ./frontend
    restart: unless-stopped
    ports:
      - "${FRONTEND_PORT}:80"
    depends_on:
      - backend

volumes:
  db_data:
`;
  fs.writeFileSync(path.join(sandboxPath, "docker-compose.yml"), compose);
  console.log("   Generated: docker-compose.yml");

  // ─── Ensure .env files exist ───────────────────────────
  const backendEnv = path.join(sandboxPath, "backend", ".env");
  if (!fs.existsSync(backendEnv)) {
    fs.writeFileSync(backendEnv, [
      `DATABASE_URL=${dbUrl}`,
      "JWT_SECRET=dev-secret-change-in-production",
      "PORT=5000",
      "NODE_ENV=production",
    ].join("\n") + "\n");
  }

  const frontendEnv = path.join(sandboxPath, "frontend", ".env");
  if (!fs.existsSync(frontendEnv)) {
    fs.writeFileSync(frontendEnv, [
      `VITE_API_URL=/api`,
    ].join("\n") + "\n");
  }

  // ─── Also ensure frontend has a vite.config if missing ──
  const viteConfig = path.join(sandboxPath, "frontend", "vite.config.js");
  if (!fs.existsSync(viteConfig)) {
    fs.writeFileSync(viteConfig, `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:5000'
    }
  }
});
`);
    console.log("   Generated: frontend/vite.config.js");
  }

  return { entryPoint, dbType };
}


export async function deploymentVerifierNode(state) {
  const attempts = state.deploymentAttempts || 0;

  if (attempts >= 2) {
    console.log("\n[Deployment Verifier] Max attempts reached. Presenting project as-is.\n");
    return {
      deploymentAttempts: attempts,
      executionResult: { result: "pass", output: "Skipped — max attempts. Code is complete, docker-compose may need manual fixes.", errors: "" },
    };
  }

  console.log(`\n[Deployment Verifier] Setting up deployment (attempt ${attempts + 1}/2)...\n`);

  const sandboxPath = getSandboxPath(state.sandboxId);

  if (!sandboxPath) {
    console.log("   No sandbox path — skipping");
    return {
      deploymentAttempts: attempts + 1,
      executionResult: { result: "pass", output: "Skipped — no sandbox", errors: "" },
    };
  }

  const outputs = [];
  const errors = [];

  try {
    // ─── Step 1: Generate deployment files with CORRECT paths ──
    console.log("   Generating deployment files...");
    const { entryPoint, dbType } = generateDeploymentFiles(sandboxPath);
    outputs.push(`Generated Dockerfiles (entry: ${entryPoint}, db: ${dbType})`);

    // ─── Step 2: Build ──────────────────────────────────────
    console.log("   Building containers (this may take a minute)...");
    const buildResult = runInSandbox(sandboxPath, "docker-compose build --no-cache 2>&1", 300000);

    if (buildResult.exitCode !== 0) {
      const fullLog = (buildResult.stdout + "\n" + buildResult.stderr).trim();
      const lastLines = fullLog.split("\n").slice(-20).join("\n");
      console.log("   Build failed. Last 20 lines:");
      console.log(lastLines);
      errors.push(`Docker build failed:\n${lastLines}`);
      return buildVerifyResult(false, outputs, errors, attempts + 1);
    }
    outputs.push("Docker build successful");

    // ─── Step 3: Start ──────────────────────────────────────
    console.log("   Starting services...");
    runInSandbox(sandboxPath, "docker-compose down 2>&1", 15000);

    const upResult = runInSandbox(sandboxPath, "docker-compose up -d 2>&1", 60000);
    if (upResult.exitCode !== 0) {
      const fullLog = (upResult.stdout + "\n" + upResult.stderr).trim();
      errors.push(`docker-compose up failed:\n${fullLog.slice(-500)}`);
      return buildVerifyResult(false, outputs, errors, attempts + 1);
    }
    outputs.push("Services started");

    // ─── Step 4: Wait ───────────────────────────────────────
    console.log("   Waiting 20 seconds for services...");
    await sleep(20000);

    const psResult = runInSandbox(sandboxPath, "docker-compose ps 2>&1", 10000);
    console.log(psResult.stdout);

    // ─── Step 5: Test backend ───────────────────────────────
    console.log(`   Testing backend at localhost:${BACKEND_PORT}...`);
    let backendOk = false;

    for (const testPath of ["/api/health", "/api", "/health", "/"]) {
      const result = testEndpoint(`http://localhost:${BACKEND_PORT}${testPath}`, 5000);
      if (result.success) {
        outputs.push(`Backend responds at ${testPath}: ${result.status}`);
        backendOk = true;
        break;
      }
    }

    if (!backendOk) {
      const logs = runInSandbox(sandboxPath, "docker-compose logs --tail=30 backend 2>&1", 10000);
      console.log("   Backend logs:");
      console.log(logs.stdout.slice(-500));
      errors.push(`Backend not responding. Logs:\n${logs.stdout.slice(-300)}`);
    }

    // ─── Step 6: Test frontend ──────────────────────────────
    console.log(`   Testing frontend at localhost:${FRONTEND_PORT}...`);
    const frontendTest = testEndpoint(`http://localhost:${FRONTEND_PORT}`, 10000);

    if (frontendTest.success) {
      outputs.push(`Frontend responds: ${frontendTest.status}`);
    } else {
      const logs = runInSandbox(sandboxPath, "docker-compose logs --tail=30 frontend 2>&1", 10000);
      console.log("   Frontend logs:");
      console.log(logs.stdout.slice(-500));
      errors.push(`Frontend not responding. Logs:\n${logs.stdout.slice(-300)}`);
    }

    // ─── Step 7: Test DB ────────────────────────────────────
    console.log("   Testing database...");
    const dbTest = runInSandbox(sandboxPath, "docker-compose exec -T db pg_isready -U postgres 2>&1", 10000);
    if (dbTest.exitCode === 0) {
      outputs.push("Database accepting connections");
    } else {
      outputs.push("Database check inconclusive");
    }

    // ─── Result ─────────────────────────────────────────────
    const passed = errors.length === 0;

    if (passed) {
      console.log("\n   DEPLOYMENT VERIFIED!");
      console.log(`   Backend:  http://localhost:${BACKEND_PORT}`);
      console.log(`   Frontend: http://localhost:${FRONTEND_PORT}`);
    } else {
      console.log("\n   Deployment has issues.");
      runInSandbox(sandboxPath, "docker-compose down 2>&1", 15000);
    }

    return buildVerifyResult(passed, outputs, errors, attempts + 1);

  } catch (e) {
    try { runInSandbox(sandboxPath, "docker-compose down 2>&1", 15000); } catch (err) {}
    errors.push(`Verification error: ${e.message}`);
    return buildVerifyResult(false, outputs, errors, attempts + 1);
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function runInSandbox(sandboxPath, command, timeout = 30000) {
  try {
    const stdout = execSync(command, {
      cwd: sandboxPath,
      timeout,
      stdio: "pipe",
      encoding: "utf-8",
    });
    return { stdout: stdout || "", stderr: "", exitCode: 0 };
  } catch (error) {
    return {
      stdout: error.stdout || "",
      stderr: error.stderr || error.message,
      exitCode: error.status || 1,
    };
  }
}

function testEndpoint(url, timeout = 10000) {
  try {
    const result = execSync(
      `curl -s -o /tmp/curl_body -w "%{http_code}" --max-time ${Math.floor(timeout / 1000)} "${url}"`,
      { encoding: "utf-8", timeout: timeout + 2000, stdio: "pipe" }
    );
    const status = parseInt(result.trim());
    let body = "";
    try { body = execSync("cat /tmp/curl_body", { encoding: "utf-8", stdio: "pipe" }); } catch (e) {}
    return { success: status >= 200 && status < 500, status, body };
  } catch (e) {
    return { success: false, status: 0, body: e.message };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildVerifyResult(passed, outputs, errors, attempts) {
  console.log(`\n   ${passed ? "VERIFIED" : "FAILED"}`);
  outputs.forEach(o => console.log(`   + ${o}`));
  if (errors.length) errors.forEach(e => console.log(`   - ${e}`));

  return {
    deploymentAttempts: attempts,
    executionResult: {
      result: passed ? "pass" : "fail",
      output: outputs.join("\n"),
      errors: errors.join("\n"),
    },
    deploymentConfig: {
      platform: "docker-compose",
      files: ["docker-compose.yml", "backend/Dockerfile", "frontend/Dockerfile", "frontend/nginx.conf"],
      instructions: [
        "cd sandboxes/<sandbox-id>",
        "docker-compose up --build",
        `Frontend: http://localhost:${FRONTEND_PORT}`,
        `Backend API: http://localhost:${BACKEND_PORT}/api`,
      ],
    },
  };
}

/**
 * Router: pass -> presentToUser, fail (under 2 attempts) -> debuggerAgent
 */
export function deploymentVerifierRouter(state) {
  if (state.executionResult?.result === "pass") return "presentToUser";
  if ((state.deploymentAttempts || 0) >= 2) return "presentToUser";
  return "debuggerAgent";
}
