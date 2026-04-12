/**
 * coderAgent.js — Coder Agent (v3: One File Per Call)
 * 
 * KEY CHANGES:
 * 1. ONE FILE PER LLM CALL — prevents truncation, each response is small
 * 2. Knows what files exist on disk — won't overwrite scaffold
 * 3. Validates output path matches requested path
 * 4. On retry: reads current file from disk, includes executor errors
 * 5. Shorter system prompt — rules split into backend vs frontend
 * 6. Protect scaffold files from being overwritten
 */

import { safeCallGemini, makeTokenDelta, emptyTokenDelta } from "../utils/gemini.js";
import { writeFile, readFile, getFileList } from "../utils/sandboxManager.js";

// ═══════════════════════════════════════════════════════════
// SYSTEM PROMPTS — split by file type so each is smaller
// ═══════════════════════════════════════════════════════════

const BACKEND_PROMPT = `You are a senior backend developer. Write ONE file.

OUTPUT FORMAT (strict JSON — single file only):
{
  "path": "backend/src/models/todoItem.js",
  "content": "// Full file content here",
  "notes": "Brief explanation"
}

RULES:
- ES module syntax ONLY (import/export, never require)
- Express: use Router(), router.get/post/put/delete
- DB: ALWAYS parameterized queries ($1, $2). NEVER string concatenation.
- Models: return clean data (not raw {rows}). Mark async functions.
- Response format EVERYWHERE: { success: true/false, data: ... } or { success: false, message: "..." }
  200: { success: true, data: result }
  201: { success: true, data: newItem }
  400: { success: false, message: "Invalid input" }
  401: { success: false, message: "Unauthorized" }
  404: { success: false, message: "Not found" }
  500: { success: false, message: error.message }
- Auth: JWT Bearer token. req.headers.authorization?.split(' ')[1]. req.user = decoded.
- Env vars: process.env.DATABASE_URL, process.env.JWT_SECRET, process.env.PORT
- .js extension in ALL imports (required for ES modules)
- Write COMPLETE files. No TODO, no placeholders.
- Keep code concise: 60-120 lines target. No excessive comments.`;

const FRONTEND_PROMPT = `You are a senior React developer. Write ONE file.

OUTPUT FORMAT (strict JSON — single file only):
{
  "path": "frontend/src/pages/DashboardPage.jsx",
  "content": "// Full file content here",
  "notes": "Brief explanation"
}

RULES:
- Functional components with hooks (useState, useEffect, useContext)
- Use Tailwind CSS — NO inline styles, NO CSS modules
- Import api utility: import api from '../utils/api' (already configured with auth)
- Navigation: import { useNavigate, Link } from 'react-router-dom'
- ALWAYS include loading state and error state
- Forms: controlled inputs, onSubmit with e.preventDefault()
- NEVER use process.env (use import.meta.env for Vite)

DESIGN SYSTEM — DARK MODE (follow strictly):
- Background: bg-gray-950. Cards: bg-gray-900/80 border border-gray-800/60 rounded-2xl p-6
- Text: text-white (titles), text-gray-300 (body), text-gray-500 (meta)
- Accent: emerald. Buttons: bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-4 py-2.5
- Inputs: bg-gray-800/50 border border-gray-700 rounded-xl px-4 py-3 text-gray-100 focus:ring-2 focus:ring-emerald-500/40
- Tables: header text-xs text-gray-500 uppercase. Rows: hover:bg-gray-800/30
- Loading: animate-pulse skeleton. Empty: centered text-gray-500 message.
- Nav bar: h-16 bg-gray-900/80 border-b border-gray-800 sticky top-0 z-50
- Icons: Use Unicode symbols (+ × ← →), NO emoji
- Write COMPLETE files. No TODO. Keep concise: 60-120 lines.`;

// Files created by sandbox scaffold — never overwrite these
const SCAFFOLD_FILES = new Set([
  "backend/src/index.js",
  "backend/src/config/db.js",
  "backend/src/middleware/auth.js",
  "frontend/index.html",
  "frontend/src/main.jsx",
  "frontend/src/App.jsx",
  "frontend/src/index.css",
  "frontend/src/utils/api.js",
  "frontend/tailwind.config.js",
  "frontend/postcss.config.js",
  "frontend/vite.config.js",
]);

export async function coderAgentNode(state) {
  console.log("\n[Coder Agent] Writing code...\n");

  const { currentTask, contextPackage, sandboxId } = state;

  if (!currentTask || !contextPackage) {
    console.log("   No task or context");
    return { coderOutput: null };
  }

  const filesToCreate = contextPackage.task.filesToCreate || [];
  const isRetry = state.reviewResult?.verdict === "rejected" && (state.reviewResult?.issues?.length > 0);
  
  // Get existing files on disk for awareness
  let existingFiles = [];
  try { existingFiles = getFileList(sandboxId); } catch (e) {}

  // Build shared context (same for all files in this task)
  let sharedContext = "";
  
  // Naming map
  if (contextPackage.namingMap?.length) {
    sharedContext += `NAMING MAP:\n`;
    contextPackage.namingMap.forEach(n => {
      sharedContext += `  ${n.entity} → table: ${n.tableName}, api: ${n.apiPath}, model: ${n.modelFile}, route: ${n.routeFile}\n`;
    });
    sharedContext += "\n";
  }

  // Dependencies
  const deps = contextPackage.dependencyInterfaces || {};
  if (Object.keys(deps).length > 0) {
    sharedContext += `EXISTING FILES YOU CAN IMPORT FROM:\n`;
    for (const [depPath, info] of Object.entries(deps)) {
      sharedContext += `  ${depPath}: ${info.importStatement || ""}\n`;
      if (info.interface) sharedContext += `    → ${info.interface}\n`;
    }
    sharedContext += "\n";
  }

  // DB schema
  if (contextPackage.dbSchema) {
    sharedContext += `DATABASE: ${contextPackage.dbSchema.databaseType}\nTABLES: ${JSON.stringify(contextPackage.dbSchema.tables, null, 2)}\n\n`;
  }

  // API endpoints (for frontend)
  if (contextPackage.apiEndpoints) {
    sharedContext += `API ENDPOINTS:\n${JSON.stringify(contextPackage.apiEndpoints, null, 2)}\n\n`;
  }

  // Scaffold awareness — tell coder what already exists
  const scaffoldOnDisk = existingFiles.filter(f => SCAFFOLD_FILES.has(f));
  if (scaffoldOnDisk.length > 0) {
    sharedContext += `ALREADY EXISTS (do NOT recreate, just import from them):\n`;
    scaffoldOnDisk.forEach(f => { sharedContext += `  - ${f}\n`; });
    sharedContext += "\n";
  }

  // Template
  if (contextPackage.templateFile) {
    sharedContext += `STYLE TEMPLATE (match this pattern):\n--- ${contextPackage.templateFile.path} ---\n${contextPackage.templateFile.content}\n\n`;
  }

  // Retry context
  let retryContext = "";
  if (isRetry) {
    retryContext += `\n=== RETRY — FIX THESE ISSUES ===\n`;
    (state.reviewResult?.issues || []).forEach(issue => { retryContext += `  - ${issue}\n`; });
    if (state.executionResult?.errors) {
      retryContext += `\nEXECUTOR ERROR:\n${state.executionResult.errors.slice(0, 400)}\n`;
    }
  }

  // ═══════════════════════════════════════════════════════
  // ONE FILE PER LLM CALL
  // ═══════════════════════════════════════════════════════

  const allWrittenFiles = [];
  let totalTokens = { input: 0, output: 0, cost: 0 };

  for (const filePath of filesToCreate) {
    // Skip scaffold files
    if (SCAFFOLD_FILES.has(filePath)) {
      console.log(`   SKIP (scaffold): ${filePath}`);
      continue;
    }

    console.log(`   Generating: ${filePath}`);

    const isBackend = filePath.includes("backend");
    const systemPrompt = isBackend ? BACKEND_PROMPT : FRONTEND_PROMPT;

    // Build per-file prompt
    let filePrompt = `FILE TO WRITE: ${filePath}\n`;
    filePrompt += `TASK: ${currentTask.title}\n`;
    filePrompt += `DESCRIPTION: ${currentTask.description || ""}\n\n`;

    if (contextPackage.task.acceptanceCriteria?.length) {
      filePrompt += `ACCEPTANCE CRITERIA:\n${contextPackage.task.acceptanceCriteria.map(c => `  - ${c}`).join("\n")}\n\n`;
    }

    filePrompt += sharedContext;

    // On retry: include current file from disk
    if (isRetry) {
      filePrompt += retryContext;
      try {
        const currentContent = readFile(sandboxId, filePath);
        if (currentContent) {
          filePrompt += `\nCURRENT FILE ON DISK (fix it, don't rewrite from scratch):\n--- ${filePath} ---\n${currentContent}\n`;
        }
      } catch (e) {}
    }

    filePrompt += `\nAPP: ${contextPackage.appName}\nOUTPUT: Return JSON with path, content, notes. The "path" MUST be exactly "${filePath}".\n`;

    const result = await safeCallGemini({
      systemPrompt,
      userPrompt: filePrompt,
      agentName: "coderAgent",
      currentCost: state.tokenUsage?.estimatedCost + totalTokens.cost || 0,
      tokenBudget: state.tokenBudget,
    });

    if (!result.ok) {
      console.error(`   FAILED: ${filePath} — ${result.error}`);
      allWrittenFiles.push({ path: filePath, lines: 0, error: result.error });
      continue;
    }

    // Parse — handle both single file and files array format
    let fileData = result.parsed;
    if (fileData.files && Array.isArray(fileData.files)) {
      fileData = fileData.files[0] || {};
    }

    const outputPath = fileData.path || filePath;
    const content = fileData.content || "";

    if (!content) {
      console.error(`   EMPTY: ${filePath} — LLM returned no content`);
      allWrittenFiles.push({ path: filePath, lines: 0, error: "Empty content" });
      continue;
    }

    // Path validation: warn if LLM returned different path
    let writePath = filePath; // Always write to the REQUESTED path
    if (outputPath !== filePath) {
      console.warn(`   PATH MISMATCH: requested "${filePath}" but LLM returned "${outputPath}". Using requested path.`);
    }

    // Write protection: don't overwrite scaffold on first attempt (retry is OK)
    if (SCAFFOLD_FILES.has(writePath) && !isRetry) {
      console.log(`   PROTECTED: ${writePath} (scaffold file, skipping)`);
      continue;
    }

    // Write to disk
    try {
      writeFile(sandboxId, writePath, content);
      const lines = content.split("\n").length;
      console.log(`   OK: ${writePath} (${lines} lines)`);
      allWrittenFiles.push({ path: writePath, lines });
    } catch (err) {
      console.error(`   WRITE FAILED: ${writePath} — ${err.message}`);
      allWrittenFiles.push({ path: writePath, lines: 0, error: err.message });
    }

    // Accumulate tokens
    totalTokens.input += result.tokens.input;
    totalTokens.output += result.tokens.output;
    totalTokens.cost += result.tokens.cost;
  }

  // ═══════════════════════════════════════════════════════

  const successCount = allWrittenFiles.filter(f => !f.error).length;
  const failCount = allWrittenFiles.filter(f => f.error).length;
  console.log(`\n   Done: ${successCount} written, ${failCount} failed`);

  // If ALL files failed, mark as error for reviewer to reject
  const allFailed = successCount === 0 && filesToCreate.length > 0;

  return {
    coderOutput: {
      files: allWrittenFiles,
      notes: allFailed ? "All files failed to generate" : `${successCount} files written`,
      error: allFailed,
    },
    tokenUsage: makeTokenDelta("coderAgent", totalTokens),
  };
}
