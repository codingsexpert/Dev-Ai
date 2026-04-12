/**
 * OutputPanel.jsx — Tabbed Output Display
 * No emojis. Clean tabs. Code-style output rendering.
 */

import { useState } from "react";
import useProjectStore from "../store/projectStore";

const TABS = [
  { key: "spec", label: "Spec" },
  { key: "blueprint", label: "Blueprint" },
  { key: "tasks", label: "Tasks" },
  { key: "code", label: "Code" },
  { key: "final", label: "Result" },
];

export default function OutputPanel() {
  const [activeTab, setActiveTab] = useState("spec");
  const spec = useProjectStore((s) => s.spec);
  const blueprint = useProjectStore((s) => s.blueprint);
  const validation = useProjectStore((s) => s.validation);
  const taskQueue = useProjectStore((s) => s.taskQueue);
  const taskStatuses = useProjectStore((s) => s.taskStatuses);
  const coderOutput = useProjectStore((s) => s.coderOutput);
  const finalState = useProjectStore((s) => s.finalState);

  return (
    <div className="panel output-panel">
      <div className="panel-head">
        <span className="panel-tag">OUT</span>
        <span className="panel-title">Output</span>
      </div>

      <div className="tab-row">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`tab-btn ${activeTab === tab.key ? "tab-btn--active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="output-body">
        {activeTab === "spec" && <SpecView spec={spec} />}
        {activeTab === "blueprint" && (
          <BlueprintView blueprint={blueprint} validation={validation} />
        )}
        {activeTab === "tasks" && (
          <TasksView taskQueue={taskQueue} taskStatuses={taskStatuses} />
        )}
        {activeTab === "code" && <CodeView coderOutput={coderOutput} />}
        {activeTab === "final" && <FinalView finalState={finalState} />}
      </div>
    </div>
  );
}

function SpecView({ spec }) {
  if (!spec) return <Empty text="Spec appears after PM completes" />;
  return <pre className="code-block">{JSON.stringify(spec, null, 2)}</pre>;
}

function BlueprintView({ blueprint, validation }) {
  if (!blueprint?.entities?.length)
    return <Empty text="Blueprint appears after Architect completes" />;

  return (
    <div className="output-section">
      {validation && (
        <div className={`inline-badge ${validation.isValid ? "badge--ok" : "badge--fail"}`}>
          {validation.isValid ? "VALIDATED" : "VALIDATION FAILED"}
          {validation.validationCycles > 0 && ` // ${validation.validationCycles} cycles`}
        </div>
      )}

      <h4 className="section-heading">Entities [{blueprint.entities.length}]</h4>
      {blueprint.entities.map((e, i) => (
        <div key={i} className="list-item">
          <span className="list-key">{e.name}</span>
          {e.description && <span className="list-val">{e.description}</span>}
        </div>
      ))}

      {blueprint.apiEndpoints?.length > 0 && (
        <>
          <h4 className="section-heading">Endpoints [{blueprint.apiEndpoints.length}]</h4>
          {blueprint.apiEndpoints.map((ep, i) => (
            <div key={i} className="endpoint-row">
              <span className={`http-method m-${(ep.method || "GET").toLowerCase()}`}>
                {ep.method || "GET"}
              </span>
              <code className="endpoint-path">{ep.path}</code>
              {ep.requiresAuth && <span className="auth-tag">AUTH</span>}
            </div>
          ))}
        </>
      )}

      {blueprint.frontendPages?.length > 0 && (
        <>
          <h4 className="section-heading">Pages [{blueprint.frontendPages.length}]</h4>
          {blueprint.frontendPages.map((p, i) => (
            <div key={i} className="list-item">
              <code className="list-key">{p.route}</code>
              <span className="list-val">{p.name}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function TasksView({ taskQueue, taskStatuses }) {
  if (!taskQueue?.phases?.length)
    return <Empty text="Tasks appear after Planner completes" />;

  const total = taskQueue.phases.reduce((s, p) => s + (p.tasks?.length || 0), 0);
  const done = Object.values(taskStatuses).filter((s) => s === "done").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="output-section">
      <div className="progress-header">
        <span className="progress-label">{done}/{total} tasks</span>
        <span className="progress-pct">{pct}%</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>

      {taskQueue.phases.map((phase, pi) => (
        <div key={pi} className="task-group">
          <h4 className="section-heading">
            Phase {phase.phaseNumber}: {phase.phaseName}
          </h4>
          {phase.tasks?.map((task, ti) => {
            const s = taskStatuses[task.taskId] || "pending";
            return (
              <div key={ti} className={`task-row task-row--${s}`}>
                <span className="task-indicator">
                  {s === "done" ? "[x]" : s === "in_progress" ? "[~]" : "[ ]"}
                </span>
                <span className="task-id">{task.taskId}</span>
                <span className="task-name">{task.title}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function CodeView({ coderOutput }) {
  if (!coderOutput) return <Empty text="Code output appears during dev loop" />;
  return <pre className="code-block">{JSON.stringify(coderOutput, null, 2)}</pre>;
}

function FinalView({ finalState }) {
  if (!finalState) return <Empty text="Final result appears on completion" />;
  return (
    <div className="output-section">
      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">SANDBOX</span>
          <span className="stat-value">{finalState.sandboxId || "—"}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">FILES</span>
          <span className="stat-value">{finalState.fileRegistryCount || 0}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">COST</span>
          <span className="stat-value">
            ${(finalState.tokenUsage?.estimatedCost || 0).toFixed(4)}
          </span>
        </div>
      </div>
      <pre className="code-block">{JSON.stringify(finalState, null, 2)}</pre>
    </div>
  );
}

function Empty({ text }) {
  return <div className="empty-state">{text}</div>;
}
