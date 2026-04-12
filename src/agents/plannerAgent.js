/**
 * plannerAgent.js — Planner Agent
 * 
 * Now includes Phase 6: deployment (Dockerfiles + docker-compose)
 * so the generated project can run with: docker-compose up
 */

import { safeCallGemini, callGemini, makeTokenDelta, emptyTokenDelta } from "../utils/gemini.js";

const PLANNER_PROMPT = `You are the Planner Agent in an AI software development team.

ROLE: Senior tech lead who creates the build plan.

GOAL: Break the architecture blueprint into ordered coding tasks.

MANDATORY PHASE ORDER:
1. "setup" — Project scaffolding, DB connection file, environment config
2. "models" — Database models/schemas (one task per entity)
3. "middleware" — Auth middleware, error handler, validators
4. "backend" — API routes (one task per resource/entity)
5. "frontend" — React pages + components (one task per page)
6. "integration" — Wire frontend to backend, App.jsx routing, main entry points
7. "deployment" — Dockerfiles for backend + frontend, docker-compose.yml, final README

OUTPUT FORMAT (strict JSON):
{
  "phases": [
    {
      "phaseNumber": 1,
      "phaseName": "setup",
      "description": "What this phase accomplishes",
      "tasks": [
        {
          "taskId": "setup-1",
          "title": "Short task title",
          "description": "What exactly to build",
          "filesToCreate": ["backend/src/config/db.js"],
          "filesNeeded": [],
          "acceptanceCriteria": ["DB config exports pool and connectDB"],
          "canParallelize": false,
          "estimatedTokens": 500
        }
      ]
    }
  ],
  "totalTasks": 18,
  "estimatedTotalTokens": 10000
}

RULES:
- Each task creates 1-3 files max.
- "filesNeeded" = files this task imports from (must exist from prior tasks).
- "filesToCreate" = files this task writes.
- Phase 2 (models) tasks are parallelizable.
- Phase 4 (backend routes) tasks are parallelizable.
- Phase 5 (frontend pages) tasks are parallelizable.
- Give each task a unique taskId: "phaseName-N".
- Keep task count 15-25 for a typical CRUD app.

IMPORTANT — THESE FILES ALREADY EXIST (scaffolded automatically, do NOT create them):
- backend/src/config/db.js (DB connection pool)
- backend/src/middleware/auth.js (JWT auth middleware)
- backend/src/index.js (Express entry — routes are auto-wired after your route tasks complete)
- frontend/index.html, frontend/src/main.jsx, frontend/src/App.jsx (auto-assembled)
- frontend/src/index.css, frontend/tailwind.config.js, frontend/postcss.config.js, frontend/vite.config.js
- frontend/src/utils/api.js (axios instance with auth interceptor)
- .gitignore, all .env files

So your Phase 1 (setup) should ONLY create files that are project-SPECIFIC:
- Maybe a frontend AuthContext if auth is needed
- Maybe backend utility helpers specific to this app
- Do NOT recreate db.js, auth middleware, api.js, or config files.

Phase 6 (integration): Do NOT create backend/src/index.js or frontend/src/App.jsx — they are AUTO-ASSEMBLED from the route and page files you create in earlier phases. If you need an integration task, use it for wiring specific features (e.g. a shared layout component, or connecting auth flow).

Phase 7 (deployment): Include ONLY a README.md task. Docker files are auto-generated.

- File paths should NOT start with / (use relative: "backend/src/..." not "/backend/src/...")
- Backend models MUST use the file name format from the entity map: e.g., if entity.modelFile = "todoItem", the file is "backend/src/models/todoItem.js"
- Backend routes MUST match: e.g., if entity.routeFile = "todoItemRoutes", file is "backend/src/routes/todoItemRoutes.js"`;

export async function plannerAgentNode(state) {
  console.log("\n📋 [Planner Agent] Creating build plan...\n");

  const { blueprint, clarifiedSpec } = state;

  const blueprintSummary = {
    databaseType: blueprint.dbSchema?.databaseType,
    entities: blueprint.entities?.map(e => ({
      name: e.name,
      tableName: e.tableName,
      apiPath: e.apiPath,
      modelFile: e.modelFile,
      routeFile: e.routeFile,
    })),
    tables: blueprint.dbSchema?.tables?.map(t => ({
      name: t.name,
      fieldCount: t.fields?.length,
      foreignKeys: t.foreignKeys?.map(fk => fk.references),
    })),
    apiEndpoints: blueprint.apiEndpoints?.map(e => ({
      method: e.method,
      path: e.path,
      relatedTable: e.relatedTable,
      requiresAuth: e.requiresAuth,
    })),
    frontendPages: blueprint.frontendPages?.map(p => ({
      name: p.name,
      route: p.route,
      componentCount: p.components?.length,
    })),
    folderStructure: blueprint.folderStructure,
    backendDeps: Object.keys(blueprint.dependencies?.backend?.dependencies || {}),
    frontendDeps: Object.keys(blueprint.dependencies?.frontend?.dependencies || {}),
  };

  const result = await safeCallGemini({
    systemPrompt: PLANNER_PROMPT,
    userPrompt: `App: ${clarifiedSpec.appName}\n\nBlueprint:\n${JSON.stringify(blueprintSummary, null, 2)}\n\nSpec:\n${JSON.stringify(clarifiedSpec, null, 2)}`,
    agentName: "plannerAgent",
    currentCost: state.tokenUsage?.estimatedCost || 0,
    tokenBudget: state.tokenBudget,
  });


  if (!result.ok) {
    console.error(`   [plannerAgent] LLM failed: ${result.error}`);
    return { error: `plannerAgent failed: ${result.error}`, tokenUsage: emptyTokenDelta("plannerAgent") };
  }

  const plan = result.parsed;

  console.log(`   📦 Total phases: ${plan.phases?.length || 0}`);
  console.log(`   📝 Total tasks: ${plan.totalTasks || "?"}`);
  console.log("");

  if (plan.phases) {
    for (const phase of plan.phases) {
      const parallelCount = phase.tasks?.filter(t => t.canParallelize).length || 0;
      console.log(`   Phase ${phase.phaseNumber}: ${phase.phaseName} — ${phase.tasks?.length || 0} tasks (${parallelCount} parallelizable)`);
      phase.tasks?.forEach(t => {
        console.log(`     ${t.canParallelize ? "∥" : "→"} ${t.taskId}: ${t.title}`);
      });
    }
  }

  return {
    taskQueue: plan,
    currentPhaseIndex: 0,
    currentTaskIndex: 0,
    tokenUsage: makeTokenDelta("plannerAgent", result.tokens),
    currentPhase: "sandbox",
  };
}
