/**
 * graphRunner.js — The Bridge Between LangGraph and WebSocket
 * 
 * FIRST PRINCIPLES:
 * The core problem: graph.stream() is an async iterator that yields
 * node-by-node updates. We need to:
 * 1. Pipe each update to the WebSocket (so frontend sees real-time progress)
 * 2. PAUSE when a human-input node runs (PM clarification, escalation)
 * 3. WAIT for the frontend to send the human's response via WebSocket
 * 4. RESUME the graph with that response
 * 
 * The trick: We DON'T use graph.stream() directly for human-in-the-loop.
 * Instead, we modify humanInput and humanEscalation nodes to use a
 * Promise-based "input bridge" — the node awaits a Promise, the WebSocket
 * handler resolves it when the user responds.
 * 
 * ARCHITECTURE:
 * 
 *   graph.stream()  ──yields──>  GraphRunner  ──emits──>  WebSocket  ──>  React
 *                                     ↑                       │
 *                                     │                       │
 *                               inputBridge             user responds
 *                            (Promise resolve)          via WebSocket
 */

import { buildGraph, createCheckpointer } from "../../src/config/graph.js";
import { initGemini } from "../../src/utils/gemini.js";

/**
 * Active project runs — maps projectId to run context
 * Each entry holds the abort controller, input bridge, and metadata
 */
const activeRuns = new Map();

/**
 * InputBridge — The mechanism for human-in-the-loop over WebSocket
 * 
 * When a human-input node needs user response:
 * 1. Node calls inputBridge.waitForInput(type, payload)
 * 2. This creates a Promise and stores the resolver
 * 3. The WebSocket handler calls inputBridge.provideInput(data)
 * 4. Promise resolves, node continues
 */
class InputBridge {
  constructor() {
    this._resolver = null;
    this._pendingType = null;
    this._pendingPayload = null;
    this._emitFn = null; // Set by graphRunner to emit WS events
  }

  /** Set the emit function so bridge can notify the dashboard */
  setEmitFn(fn) {
    this._emitFn = fn;
  }

  /**
   * Called by human-input nodes when they need user response.
   * ALSO emits a WebSocket event so the dashboard shows the input panel.
   */
  waitForInput(type, payload) {
    this._pendingType = type;
    this._pendingPayload = payload;

    // Emit event to dashboard NOW (before waiting)
    if (this._emitFn) {
      this._emitFn({
        type: "human_input_needed",
        inputType: type,
        questions: payload?.questions || [],
        task: payload?.task || null,
        error: payload?.error || null,
        timestamp: Date.now(),
      });
    }

    return new Promise((resolve) => {
      this._resolver = resolve;
    });
  }

  /**
   * Called by WebSocket handler when user sends their response
   */
  provideInput(data) {
    if (this._resolver) {
      const resolver = this._resolver;
      this._resolver = null;
      this._pendingType = null;
      this._pendingPayload = null;
      resolver(data);
    }
  }

  get isPending() {
    return this._resolver !== null;
  }

  get pendingType() {
    return this._pendingType;
  }

  get pendingPayload() {
    return this._pendingPayload;
  }
}

/**
 * Global input bridge registry — one per active project
 * Human-input nodes import this to check if they're running
 * in server mode vs CLI mode.
 */
export const inputBridges = new Map();

/**
 * Start a new project run
 * 
 * @param {string} projectId - Unique project/thread ID
 * @param {string} requirement - User's requirement text
 * @param {function} emit - Callback to send events (goes to WebSocket)
 * @param {object} options - { tokenBudget, resumeThreadId }
 * @returns {object} - { projectId, threadId }
 */
export async function startProject(projectId, requirement, emit, options = {}) {
  const { tokenBudget = 2.0 } = options;

  // 1. Initialize Gemini if not already
  try {
    initGemini(process.env.GEMINI_API_KEY);
  } catch (e) {
    // Already initialized — ignore
  }

  // 2. Create checkpointer + graph
  const checkpointer = await createCheckpointer();
  const graph = buildGraph({ checkpointer });

  const threadId = projectId;

  // 3. Create input bridge for this project
  const inputBridge = new InputBridge();
  inputBridge.setEmitFn(emit); // Bridge can now emit WS events directly
  inputBridges.set(projectId, inputBridge);

  // 4. Create abort controller
  const abortController = new AbortController();

  // 5. Store run context
  activeRuns.set(projectId, {
    threadId,
    inputBridge,
    abortController,
    graph,
    status: "running",
    startedAt: Date.now(),
  });

  // 6. Config for LangGraph
  const config = {
    configurable: { thread_id: threadId },
    recursionLimit: 500,
  };

  // 7. Run in background (don't await — we stream events)
  _executeGraph(projectId, graph, config, requirement, tokenBudget, emit)
    .catch((error) => {
      emit({
        type: "error",
        message: error.message,
        timestamp: Date.now(),
      });
    })
    .finally(() => {
      activeRuns.delete(projectId);
      inputBridges.delete(projectId);
    });

  return { projectId, threadId };
}

/**
 * Resume an existing project
 */
export async function resumeProject(projectId, emit) {
  const checkpointer = await createCheckpointer();
  const graph = buildGraph({ checkpointer });

  const inputBridge = new InputBridge();
  inputBridge.setEmitFn(emit);
  inputBridges.set(projectId, inputBridge);

  const abortController = new AbortController();

  activeRuns.set(projectId, {
    threadId: projectId,
    inputBridge,
    abortController,
    graph,
    status: "running",
    startedAt: Date.now(),
  });

  const config = {
    configurable: { thread_id: projectId },
    recursionLimit: 500,
  };

  _executeGraph(projectId, graph, config, null, null, emit)
    .catch((error) => {
      emit({ type: "error", message: error.message, timestamp: Date.now() });
    })
    .finally(() => {
      activeRuns.delete(projectId);
      inputBridges.delete(projectId);
    });

  return { projectId, threadId: projectId };
}

/**
 * Internal: Execute the graph and stream events
 * 
 * This is where the magic happens. We use graph.stream() in "updates" mode
 * which yields { nodeName: stateUpdate } for each node execution.
 * Each yield is piped to the emit function → WebSocket → React.
 */
async function _executeGraph(projectId, graph, config, requirement, tokenBudget, emit) {
  emit({
    type: "run_started",
    projectId,
    timestamp: Date.now(),
  });

  const input = requirement
    ? { userRequirement: requirement, tokenBudget: tokenBudget || 2.0 }
    : null; // null for resume

  try {
    // stream() yields node-by-node updates
    const stream = await graph.stream(input, {
      ...config,
      streamMode: "updates",
    });

    for await (const event of stream) {
      // event shape: { nodeName: { ...partial state updates } }
      const nodeName = Object.keys(event)[0];
      const nodeOutput = event[nodeName];

      // Check abort
      if (activeRuns.get(projectId)?.abortController?.signal?.aborted) {
        emit({ type: "run_cancelled", projectId, timestamp: Date.now() });
        return;
      }

      // Emit node completion event
      emit({
        type: "node_complete",
        node: nodeName,
        data: _sanitizeForTransport(nodeOutput),
        timestamp: Date.now(),
      });

      // Special handling: extract interesting state for the dashboard
      _emitDerivedEvents(nodeName, nodeOutput, emit);
    }

    // Stream finished — get final state
    const finalState = await graph.getState(config);

    emit({
      type: "run_complete",
      projectId,
      finalState: _sanitizeForTransport(finalState?.values || {}),
      timestamp: Date.now(),
    });

  } catch (error) {
    if (error.name === "AbortError") {
      emit({ type: "run_cancelled", projectId, timestamp: Date.now() });
    } else {
      // Emit a detailed error so the dashboard can show what happened
      // and potentially offer resume
      emit({
        type: "error",
        message: error.message,
        recoverable: !error.message?.includes("TOKEN_BUDGET_EXCEEDED"),
        timestamp: Date.now(),
      });

      // Try to get the current state for debugging
      try {
        const currentState = await graph.getState(config);
        if (currentState?.values) {
          emit({
            type: "error_state",
            currentPhase: currentState.values.currentPhase,
            currentTask: currentState.values.currentTask?.title,
            sandboxId: currentState.values.sandboxId,
            timestamp: Date.now(),
          });
        }
      } catch (_) {
        // Can't get state — that's fine
      }
    }
  }
}

/**
 * Emit high-level events the dashboard cares about
 * (beyond raw node updates)
 */
function _emitDerivedEvents(nodeName, output, emit) {
  // PM needs clarification → dashboard shows input panel
  if (output.pmStatus === "needs_clarification" && output.pmQuestions?.length) {
    emit({
      type: "human_input_needed",
      inputType: "pm_clarification",
      questions: output.pmQuestions,
      timestamp: Date.now(),
    });
  }

  // Spec ready
  if (output.clarifiedSpec) {
    emit({
      type: "spec_ready",
      spec: output.clarifiedSpec,
      timestamp: Date.now(),
    });
  }

  // Blueprint update
  if (output.blueprint) {
    emit({
      type: "blueprint_update",
      blueprint: output.blueprint,
      timestamp: Date.now(),
    });
  }

  // Validation result
  if (output.blueprintValidation) {
    emit({
      type: "validation_result",
      validation: output.blueprintValidation,
      timestamp: Date.now(),
    });
  }

  // Task queue ready
  if (output.taskQueue?.phases?.length) {
    emit({
      type: "taskqueue_ready",
      taskQueue: output.taskQueue,
      timestamp: Date.now(),
    });
  }

  // Sandbox created
  if (output.sandboxId) {
    emit({
      type: "sandbox_created",
      sandboxId: output.sandboxId,
      healthy: output.sandboxHealthy,
      timestamp: Date.now(),
    });
  }

  // Task progress
  if (output.currentTask) {
    emit({
      type: "task_started",
      task: output.currentTask,
      timestamp: Date.now(),
    });
  }

  if (output.taskStatuses) {
    emit({
      type: "task_progress",
      statuses: output.taskStatuses,
      timestamp: Date.now(),
    });
  }

  // Coder output
  if (output.coderOutput) {
    emit({
      type: "code_written",
      files: output.coderOutput,
      timestamp: Date.now(),
    });
  }

  // Review result
  if (output.reviewResult?.verdict) {
    emit({
      type: "review_result",
      review: output.reviewResult,
      timestamp: Date.now(),
    });
  }

  // Execution result
  if (output.executionResult?.result) {
    emit({
      type: "execution_result",
      execution: output.executionResult,
      timestamp: Date.now(),
    });
  }

  // Token update
  if (output.tokenUsage) {
    emit({
      type: "token_update",
      usage: output.tokenUsage,
      timestamp: Date.now(),
    });
  }

  // Phase change
  if (output.currentPhase) {
    emit({
      type: "phase_change",
      phase: output.currentPhase,
      timestamp: Date.now(),
    });
  }

  // Human escalation needed
  if (nodeName === "humanEscalation") {
    emit({
      type: "human_input_needed",
      inputType: "escalation",
      task: output.currentTask,
      error: output.executionResult?.errors,
      timestamp: Date.now(),
    });
  }
}

/**
 * Strip circular refs and large blobs before sending over WebSocket
 */
function _sanitizeForTransport(obj) {
  try {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
      // Skip very large strings (e.g., full file contents)
      if (typeof value === "string" && value.length > 5000) {
        return value.substring(0, 500) + `... [truncated, ${value.length} chars]`;
      }
      return value;
    }));
  } catch {
    return { error: "Could not serialize state" };
  }
}

/**
 * Provide human input to a waiting node
 */
export function provideHumanInput(projectId, data) {
  const bridge = inputBridges.get(projectId);
  if (bridge?.isPending) {
    bridge.provideInput(data);
    return true;
  }
  return false;
}

/**
 * Cancel a running project
 */
export function cancelProject(projectId) {
  const run = activeRuns.get(projectId);
  if (run) {
    run.abortController.abort();
    run.status = "cancelled";
    return true;
  }
  return false;
}

/**
 * Get status of a running project
 */
export function getRunStatus(projectId) {
  const run = activeRuns.get(projectId);
  if (!run) return null;
  return {
    projectId,
    threadId: run.threadId,
    status: run.status,
    startedAt: run.startedAt,
    waitingForInput: run.inputBridge.isPending,
    inputType: run.inputBridge.pendingType,
  };
}

/**
 * Get all active runs
 */
export function getActiveRuns() {
  const runs = [];
  for (const [id, run] of activeRuns) {
    runs.push({
      projectId: id,
      status: run.status,
      startedAt: run.startedAt,
      waitingForInput: run.inputBridge.isPending,
    });
  }
  return runs;
}
