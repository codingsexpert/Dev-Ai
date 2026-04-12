/**
 * contextBuilder.js — Smart Context Builder (v2)
 * 
 * FIXES:
 * 1. Three-tier dependency lookup: exact → fuzzy → disk fallback
 * 2. Auto-include by convention: routes get models+middleware, pages get api util+context
 * 3. Reads ALL registry entries for the relevant directories
 * 4. Never sends empty dependency context — always finds something
 */

import { readFile, getFileList } from "../utils/sandboxManager.js";

/**
 * Extract a basic interface from file content (no LLM needed)
 * Used as fallback when registry has no entry for a file.
 */
function extractBasicInterface(content, filePath) {
  const exports = [];
  const lines = content.split("\n");
  
  for (const line of lines) {
    // export function/const/class/default
    const namedMatch = line.match(/export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/);
    if (namedMatch) exports.push(namedMatch[1]);
    
    const defaultMatch = line.match(/export\s+default\s+(?:function\s+)?(\w+)?/);
    if (defaultMatch && defaultMatch[1]) exports.push(`default:${defaultMatch[1]}`);
  }

  const hasDefault = exports.some(e => e.startsWith("default:"));
  const named = exports.filter(e => !e.startsWith("default:"));
  const defaultName = hasDefault ? exports.find(e => e.startsWith("default:")).split(":")[1] : null;

  // Build import statement
  let importStatement = "";
  const relPath = filePath; // Will be resolved by the coder based on its own location
  if (defaultName && named.length > 0) {
    importStatement = `import ${defaultName}, { ${named.join(", ")} } from '${relPath}'`;
  } else if (defaultName) {
    importStatement = `import ${defaultName} from '${relPath}'`;
  } else if (named.length > 0) {
    importStatement = `import { ${named.join(", ")} } from '${relPath}'`;
  }

  return {
    path: filePath,
    exports: [...named, ...(defaultName ? [defaultName] : [])],
    importStatement,
    interface: exports.join(", ") || "unknown exports",
  };
}

export function contextBuilderNode(state) {
  console.log("\n[Context Builder] Assembling context for Coder...\n");

  const { currentTask, blueprint, fileRegistry, projectPatterns, sandboxId, clarifiedSpec, taskStatuses } = state;

  if (!currentTask) {
    console.log("   No current task");
    return { contextPackage: null };
  }

  const context = {
    task: {
      taskId: currentTask.taskId,
      title: currentTask.title,
      description: currentTask.description,
      filesToCreate: currentTask.filesToCreate || [],
      acceptanceCriteria: currentTask.acceptanceCriteria || [],
    },
    patterns: projectPatterns || {},
    dependencyInterfaces: {},
    dbSchema: null,
    apiEndpoints: null,
    templateFile: null,
    namingMap: null,
    appName: clarifiedSpec?.appName || "app",
    authRequired: clarifiedSpec?.authRequired || false,
  };

  const registry = fileRegistry || [];
  const filesToCreate = currentTask.filesToCreate || [];

  // ─── 1. Resolve dependencies: 3-tier lookup ────────────

  const filesNeeded = currentTask.filesNeeded || [];
  
  // Also auto-detect needed files by convention
  const autoNeeded = new Set(filesNeeded);
  
  const isBackendRoute = filesToCreate.some(f => f.includes("routes") || f.includes("controllers"));
  const isBackendModel = filesToCreate.some(f => f.includes("models"));
  const isFrontendPage = filesToCreate.some(f => f.includes("pages") || f.includes("components"));
  const isIntegration = filesToCreate.some(f => 
    f.endsWith("index.js") || f.endsWith("App.jsx") || f.endsWith("server.js")
  );

  // Routes need: all models + middleware
  if (isBackendRoute) {
    registry.forEach(f => {
      if (f.path?.includes("models/") || f.path?.includes("middleware/") || f.path?.includes("config/")) {
        autoNeeded.add(f.path);
      }
    });
  }

  // Pages need: api util + auth context + hooks
  if (isFrontendPage) {
    registry.forEach(f => {
      if (f.path?.includes("utils/api") || f.path?.includes("context/") || f.path?.includes("hooks/")) {
        autoNeeded.add(f.path);
      }
    });
  }

  // Integration files need: everything in their domain
  if (isIntegration) {
    const isBackend = filesToCreate.some(f => f.includes("backend"));
    const isFrontend = filesToCreate.some(f => f.includes("frontend"));
    registry.forEach(f => {
      if (isBackend && f.path?.startsWith("backend/")) autoNeeded.add(f.path);
      if (isFrontend && f.path?.startsWith("frontend/")) autoNeeded.add(f.path);
    });
  }

  // Resolve each dependency with 3-tier lookup
  for (const filePath of autoNeeded) {
    // Don't include files we're about to create
    if (filesToCreate.includes(filePath)) continue;

    // Tier 1: Exact match in registry
    let entry = registry.find(f => f.path === filePath);
    
    // Tier 2: Fuzzy match — same directory, similar name
    if (!entry) {
      const dir = filePath.split("/").slice(0, -1).join("/");
      const fileName = filePath.split("/").pop().toLowerCase().replace(/\.(js|jsx)$/, "");
      entry = registry.find(f => {
        const fDir = f.path?.split("/").slice(0, -1).join("/");
        const fName = f.path?.split("/").pop().toLowerCase().replace(/\.(js|jsx)$/, "");
        return fDir === dir && (fName.includes(fileName) || fileName.includes(fName));
      });
      if (entry) {
        console.log(`   Fuzzy match: ${filePath} → ${entry.path}`);
      }
    }

    // Tier 3: Disk fallback — read the file directly
    if (!entry && sandboxId) {
      try {
        // Try exact path first
        let content = readFile(sandboxId, filePath);
        
        // If not found, scan directory for similar file
        if (!content) {
          const allFiles = getFileList(sandboxId);
          const dir = filePath.split("/").slice(0, -1).join("/");
          const baseName = filePath.split("/").pop().toLowerCase().replace(/\.(js|jsx)$/, "");
          const match = allFiles.find(f => {
            const fDir = f.split("/").slice(0, -1).join("/");
            const fName = f.split("/").pop().toLowerCase().replace(/\.(js|jsx)$/, "");
            return fDir === dir && (fName.includes(baseName) || baseName.includes(fName));
          });
          if (match) {
            content = readFile(sandboxId, match);
            if (content) console.log(`   Disk fallback: ${filePath} → ${match}`);
          }
        }

        if (content) {
          entry = extractBasicInterface(content, filePath);
          console.log(`   Disk read: ${filePath} → ${entry.exports.length} exports`);
        }
      } catch (e) { /* file truly doesn't exist */ }
    }

    if (entry) {
      context.dependencyInterfaces[entry.path || filePath] = {
        importStatement: entry.importStatement,
        exports: entry.exports,
        interface: entry.interface,
      };
    }
  }

  // ─── 2. Naming map from entities ──────────────────────

  if (blueprint?.entities) {
    context.namingMap = blueprint.entities.map(e => ({
      entity: e.name,
      tableName: e.tableName,
      apiPath: e.apiPath,
      modelFile: e.modelFile,
      routeFile: e.routeFile,
    }));
  }

  // ─── 3. Filtered DB schema ────────────────────────────

  const isBackendTask = filesToCreate.some(f => f.includes("backend"));
  if (isBackendTask && blueprint?.dbSchema) {
    const taskText = `${currentTask.title} ${currentTask.description}`.toLowerCase();
    const relevantTables = blueprint.dbSchema.tables?.filter(t => {
      const tableName = t.name.toLowerCase();
      const entityName = tableName.replace(/_/g, "").replace(/s$/, "");
      return taskText.includes(tableName) || taskText.includes(entityName) ||
             taskText.includes(tableName.replace(/_/g, " "));
    });
    context.dbSchema = {
      databaseType: blueprint.dbSchema.databaseType,
      tables: relevantTables?.length > 0 ? relevantTables : blueprint.dbSchema.tables,
    };
  }

  // ─── 4. Filtered API endpoints ────────────────────────

  const isFrontendTask = filesToCreate.some(f => f.includes("frontend"));
  if (isFrontendTask && blueprint?.apiEndpoints) {
    const taskText = `${currentTask.title} ${currentTask.description}`.toLowerCase();
    const relevantEndpoints = blueprint.apiEndpoints.filter(e => {
      const pathParts = e.path?.toLowerCase().split("/") || [];
      return pathParts.some(part => part.length > 2 && taskText.includes(part));
    });
    const authEndpoints = blueprint.apiEndpoints.filter(e => e.path?.includes("/auth"));
    const combined = [...new Set([...authEndpoints, ...relevantEndpoints])];
    context.apiEndpoints = combined.length > 0 ? combined : blueprint.apiEndpoints;
  }

  // ─── 5. Template file (completed similar file) ────────

  if (registry.length > 0) {
    const targetFile = filesToCreate[0] || "";
    let templateType = "";
    if (targetFile.includes("models")) templateType = "models";
    else if (targetFile.includes("routes") || targetFile.includes("controllers")) templateType = "routes";
    else if (targetFile.includes("pages")) templateType = "pages";
    else if (targetFile.includes("components")) templateType = "components";

    if (templateType) {
      const templateEntry = registry.find(f =>
        f.path?.includes(templateType) && !filesToCreate.includes(f.path)
      );
      if (templateEntry && sandboxId) {
        try {
          const content = readFile(sandboxId, templateEntry.path);
          if (content) {
            context.templateFile = {
              path: templateEntry.path,
              content: content.slice(0, 3000), // char limit instead of line limit
            };
          }
        } catch (e) { /* skip */ }
      }
    }
  }

  // ─── Log context summary ──────────────────────────────

  const contextStr = JSON.stringify(context);
  const estimatedTokens = Math.ceil(contextStr.length / 4);
  console.log(`   Context size: ~${estimatedTokens} tokens`);
  console.log(`   Files to create: ${filesToCreate.join(", ")}`);
  console.log(`   Dependencies: ${Object.keys(context.dependencyInterfaces).length} interfaces`);
  if (context.dbSchema) console.log(`   Schema: ${context.dbSchema.tables?.length} tables`);
  if (context.templateFile) console.log(`   Template: ${context.templateFile.path}`);

  return { contextPackage: context };
}
