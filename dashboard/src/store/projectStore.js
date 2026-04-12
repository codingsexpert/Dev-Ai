/**
 * store/projectStore.js — Zustand State Management
 * 
 * FIRST PRINCIPLES:
 * The dashboard needs to track:
 *   1. Connection state (connected/disconnected to WS)
 *   2. Project metadata (id, requirement, status)
 *   3. Pipeline state (which node is active, what phase)
 *   4. Event log (scrolling list of all events from graph)
 *   5. Outputs (spec, blueprint, taskQueue, code files)
 *   6. Token usage (live cost tracking)
 *   7. Human input state (questions pending, escalation pending)
 * 
 * Why Zustand over Redux/Context?
 * - Zero boilerplate, works outside React (the WS hook updates it)
 * - Selective subscriptions (components only re-render for their slice)
 * - Perfect for this use case: one global store, many readers
 */

import { create } from "zustand";

/**
 * The 27 nodes in pipeline order, grouped by phase
 * Used by PipelineVisualizer to render the flow
 */
export const PIPELINE_PHASES = {
  pm: {
    label: "PM",
    nodes: ["pmAgent", "humanInput"],
  },
  architect: {
    label: "Architect",
    nodes: [
      "architectStep1", "architectStep2", "architectStep3",
      "architectStep4", "architectStep5", "blueprintValidator",
    ],
  },
  planner: {
    label: "Planner",
    nodes: ["plannerAgent", "setupSandbox", "sandboxHealthCheck"],
  },
  dev_loop: {
    label: "Dev Loop",
    nodes: [
      "selectNextTask", "contextBuilder", "coderAgent", "updateRegistry",
      "reviewerAgent", "executorAgent", "snapshotManager",
      "debuggerAgent", "simplifyTask", "humanEscalation",
      "phaseVerification", "patternExtractor", "stateCompactor",
    ],
  },
  deploy: {
    label: "Deploy",
    nodes: ["deploymentVerifier", "presentToUser"],
  },
};

/** Flat list of all node names */
export const ALL_NODES = Object.values(PIPELINE_PHASES).flatMap((p) => p.nodes);

/** Friendly display names for nodes */
export const NODE_LABELS = {
  pmAgent: "PM Agent",
  humanInput: "Human Input",
  architectStep1: "Entities & Models",
  architectStep2: "Database Schema",
  architectStep3: "API Endpoints",
  architectStep4: "Frontend Pages",
  architectStep5: "Folder Structure",
  blueprintValidator: "Blueprint Validator",
  plannerAgent: "Task Planner",
  setupSandbox: "Setup Sandbox",
  sandboxHealthCheck: "Health Check",
  selectNextTask: "Select Next Task",
  contextBuilder: "Build Context",
  coderAgent: "Coder Agent",
  updateRegistry: "Update Registry",
  reviewerAgent: "Code Reviewer",
  executorAgent: "Executor",
  snapshotManager: "Snapshot",
  debuggerAgent: "Debugger",
  simplifyTask: "Simplify Task",
  humanEscalation: "Human Escalation",
  phaseVerification: "Phase Verification",
  patternExtractor: "Pattern Extractor",
  stateCompactor: "State Compactor",
  deploymentVerifier: "Deployment Verifier",
  presentToUser: "Present Results",
};

const useProjectStore = create((set, get) => ({
  // ─── Connection ────────────────────────────────────────
  wsConnected: false,
  setWsConnected: (connected) => set({ wsConnected: connected }),

  // ─── Project ───────────────────────────────────────────
  projectId: null,
  requirement: "",
  status: "idle", // idle | running | waiting_input | complete | error | cancelled

  setProject: (projectId, requirement) =>
    set({
      projectId,
      requirement,
      status: "running",
      events: [],
      completedNodes: [],
      activeNode: null,
      currentPhase: "pm",
      spec: null,
      blueprint: null,
      validation: null,
      taskQueue: null,
      sandboxId: null,
      sandboxHealthy: false,
      currentTask: null,
      taskStatuses: {},
      coderOutput: null,
      reviewResult: null,
      executionResult: null,
      tokenUsage: { calls: [], totalInput: 0, totalOutput: 0, estimatedCost: 0 },
      humanInputRequest: null,
      error: null,
    }),

  // ─── Pipeline State ────────────────────────────────────
  activeNode: null,
  completedNodes: [],
  currentPhase: "pm",

  // ─── Event Log ─────────────────────────────────────────
  events: [],
  maxEvents: 500, // cap to prevent memory issues

  addEvent: (event) =>
    set((state) => {
      const events = [...state.events, event];
      // Trim if over max
      if (events.length > state.maxEvents) {
        return { events: events.slice(-state.maxEvents) };
      }
      return { events };
    }),

  // ─── Outputs ───────────────────────────────────────────
  spec: null,
  blueprint: null,
  validation: null,
  taskQueue: null,
  sandboxId: null,
  sandboxHealthy: false,
  currentTask: null,
  taskStatuses: {},
  coderOutput: null,
  reviewResult: null,
  executionResult: null,
  fileRegistry: [],
  finalState: null,

  // ─── Token Usage ───────────────────────────────────────
  tokenUsage: {
    calls: [],
    totalInput: 0,
    totalOutput: 0,
    estimatedCost: 0,
  },
  tokenBudget: 2.0,

  // ─── Human Input ───────────────────────────────────────
  humanInputRequest: null, // { type, questions, task, error }

  // ─── Error ─────────────────────────────────────────────
  error: null,
  errorRecoverable: false,

  // ─── Process WebSocket events ──────────────────────────
  /**
   * Central event processor — called by the WebSocket hook
   * for every message received from the server.
   * Routes events to the appropriate state updates.
   */
  processEvent: (event) => {
    const { addEvent } = get();

    // Add to log
    addEvent(event);

    switch (event.type) {
      case "node_complete":
        set((state) => ({
          activeNode: null,
          completedNodes: state.completedNodes.includes(event.node)
            ? state.completedNodes
            : [...state.completedNodes, event.node],
        }));
        break;

      case "phase_change":
        set({ currentPhase: event.phase });
        break;

      case "spec_ready":
        set({ spec: event.spec });
        break;

      case "blueprint_update":
        set({ blueprint: event.blueprint });
        break;

      case "validation_result":
        set({ validation: event.validation });
        break;

      case "taskqueue_ready":
        set({ taskQueue: event.taskQueue });
        break;

      case "sandbox_created":
        set({ sandboxId: event.sandboxId, sandboxHealthy: event.healthy });
        break;

      case "task_started":
        set({ currentTask: event.task });
        break;

      case "task_progress":
        set((state) => ({
          taskStatuses: { ...state.taskStatuses, ...event.statuses },
        }));
        break;

      case "code_written":
        set({ coderOutput: event.files });
        break;

      case "review_result":
        set({ reviewResult: event.review });
        break;

      case "execution_result":
        set({ executionResult: event.execution });
        break;

      case "token_update":
        set({ tokenUsage: event.usage });
        break;

      case "human_input_needed":
        set({
          status: "waiting_input",
          humanInputRequest: {
            type: event.inputType,
            questions: event.questions || [],
            task: event.task || null,
            error: event.error || null,
          },
        });
        break;

      case "run_complete":
        set({
          status: "complete",
          finalState: event.finalState,
          activeNode: null,
        });
        break;

      case "run_cancelled":
        set({ status: "cancelled", activeNode: null });
        break;

      case "error":
        set({
          status: "error",
          error: event.message,
          errorRecoverable: event.recoverable ?? false,
        });
        break;

      case "error_state":
        // Extra context about where the error happened
        set((state) => ({
          error: state.error
            ? `${state.error} [at ${event.currentPhase || "unknown"}: ${event.currentTask || "unknown task"}]`
            : event.currentTask || "Unknown error location",
        }));
        break;

      case "run_started":
        set({ status: "running" });
        break;

      default:
        // Unknown event — just logged
        break;
    }
  },

  // ─── Reset ─────────────────────────────────────────────
  reset: () =>
    set({
      projectId: null,
      requirement: "",
      status: "idle",
      wsConnected: false,
      events: [],
      completedNodes: [],
      activeNode: null,
      currentPhase: "pm",
      spec: null,
      blueprint: null,
      validation: null,
      taskQueue: null,
      sandboxId: null,
      sandboxHealthy: false,
      currentTask: null,
      taskStatuses: {},
      coderOutput: null,
      reviewResult: null,
      executionResult: null,
      tokenUsage: { calls: [], totalInput: 0, totalOutput: 0, estimatedCost: 0 },
      humanInputRequest: null,
      error: null,
      finalState: null,
    }),
}));

export default useProjectStore;
