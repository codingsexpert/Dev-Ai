/**
 * humanInput.js — Human Input Node
 * 
 * FIRST PRINCIPLES:
 * LangGraph is designed for "human-in-the-loop" workflows.
 * When the PM Agent asks questions, we need to pause the graph,
 * get the user's answer, and resume.
 * 
 * DUAL MODE:
 * - CLI mode (default): uses readline to ask via terminal
 * - Server mode: uses InputBridge to pause and wait for WebSocket response
 * 
 * How it decides: checks if an InputBridge exists for this run.
 * The server's graphRunner.js registers a bridge before starting the graph.
 * If no bridge exists, we're in CLI mode.
 */

import * as readline from "readline";

/**
 * Ask the user a question via terminal (CLI mode)
 */
function askUserCLI(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Try to get the InputBridge (server mode).
 * Returns null if we're in CLI mode.
 */
async function getInputBridge() {
  try {
    const { inputBridges } = await import("../../server/services/graphRunner.js");
    // Find any active bridge (there should be exactly one during a run)
    for (const [, bridge] of inputBridges) {
      return bridge;
    }
  } catch (e) {
    // Server module not available — we're in CLI mode
  }
  return null;
}

/**
 * Human Input node function
 * 
 * Displays PM Agent's questions and collects user's answers.
 * Works in both CLI and server (WebSocket) mode.
 */
export async function humanInputNode(state) {
  const questions = state.pmQuestions;
  
  if (!questions || questions.length === 0) {
    console.log("  No questions to answer. Moving on...");
    return {};
  }

  // ─── Check if we're in server mode ─────────────────────
  const bridge = await getInputBridge();

  let answer;

  if (bridge) {
    // SERVER MODE: pause the graph and wait for WebSocket response
    console.log("  [humanInput] Waiting for user response via dashboard...");
    const response = await bridge.waitForInput("pm_clarification", { questions });
    answer = response?.answers || response?.data?.answers || JSON.stringify(response);
    console.log("  [humanInput] Got response from dashboard");
  } else {
    // CLI MODE: original readline behavior
    console.log("\n" + "═".repeat(60));
    console.log("  YOUR INPUT NEEDED");
    console.log("═".repeat(60));
    console.log("\n  Please answer the PM Agent's questions.\n");

    questions.forEach((q, i) => {
      console.log(`  ${i + 1}. ${q}`);
    });

    console.log("");
    answer = await askUserCLI("  Your answers: ");
    console.log("\n  Got it! Sending your answers to the PM Agent...\n");
  }

  return {
    pmConversation: [
      { role: "user", answers: answer },
    ],
    pmStatus: "idle",
  };
}
