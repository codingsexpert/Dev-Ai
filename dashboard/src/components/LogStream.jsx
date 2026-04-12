/**
 * LogStream.jsx — Real-time Event Log
 * No emojis. Monospace terminal style. Color-coded by event type.
 */

import { useEffect, useRef } from "react";
import useProjectStore, { NODE_LABELS } from "../store/projectStore";

const EVENT_LABELS = {
  run_started: "INIT",
  node_complete: "NODE",
  phase_change: "PHASE",
  spec_ready: "SPEC",
  blueprint_update: "ARCH",
  validation_result: "VALID",
  taskqueue_ready: "PLAN",
  sandbox_created: "SANDBOX",
  task_started: "TASK",
  task_progress: "PROGRESS",
  code_written: "CODE",
  review_result: "REVIEW",
  execution_result: "EXEC",
  token_update: "TOKENS",
  human_input_needed: "INPUT",
  run_complete: "DONE",
  run_cancelled: "ABORT",
  error: "ERROR",
  ack: "ACK",
  status: "STATUS",
};

function formatTime(ts) {
  if (!ts) return "--:--:--";
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getEventDetail(event) {
  switch (event.type) {
    case "node_complete":
      return NODE_LABELS[event.node] || event.node;
    case "phase_change":
      return event.phase?.toUpperCase();
    case "task_started":
      return event.task?.title || "";
    case "review_result":
      return event.review?.verdict?.toUpperCase() || "";
    case "execution_result":
      return event.execution?.result?.toUpperCase() || "";
    case "token_update":
      return `$${(event.usage?.estimatedCost || 0).toFixed(4)}`;
    case "human_input_needed":
      return event.inputType === "pm_clarification" ? "PM questions" : "Escalation";
    case "error":
      return event.message;
    case "validation_result":
      return event.validation?.isValid ? "PASSED" : "FAILED";
    default:
      return "";
  }
}

export default function LogStream() {
  const events = useProjectStore((s) => s.events);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <div className="panel log-panel">
      <div className="panel-head">
        <span className="panel-tag">LOG</span>
        <span className="panel-title">Event Stream</span>
        <span className="panel-meta">{events.length} events</span>
      </div>
      <div className="log-scroll" ref={scrollRef}>
        {events.length === 0 ? (
          <div className="empty-state">Waiting for events...</div>
        ) : (
          events.map((event, i) => {
            const label = EVENT_LABELS[event.type] || event.type.toUpperCase();
            const detail = getEventDetail(event);
            const isError = event.type === "error" || event.type === "run_cancelled";
            const isSuccess = event.type === "run_complete" || event.type === "node_complete";
            const isInput = event.type === "human_input_needed";

            return (
              <div
                key={i}
                className={`log-row ${isError ? "log-row--error" : ""} ${isSuccess ? "log-row--ok" : ""} ${isInput ? "log-row--warn" : ""}`}
              >
                <span className="log-ts">{formatTime(event.timestamp)}</span>
                <span className={`log-tag log-tag--${event.type}`}>{label}</span>
                {detail && <span className="log-detail">{detail}</span>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
