import { useState, useCallback, useEffect } from "react";
import useProjectStore from "./store/projectStore";
import useWebSocket from "./hooks/useWebSocket";
import { createProject, resumeProject } from "./lib/api";
import PipelineVisualizer from "./components/PipelineVisualizer";
import LogStream from "./components/LogStream";
import OutputPanel from "./components/OutputPanel";
import HumanInputPanel from "./components/HumanInputPanel";
import TokenBudgetBar from "./components/TokenBudgetBar";

export default function App() {
  const [requirementInput, setRequirementInput] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [theme, setTheme] = useState(() => {
    const savedTheme = window.localStorage.getItem("dashboard-theme");
    return savedTheme || "dark";
  });

  const projectId = useProjectStore((s) => s.projectId);
  const requirement = useProjectStore((s) => s.requirement);
  const status = useProjectStore((s) => s.status);
  const wsConnected = useProjectStore((s) => s.wsConnected);
  const humanInputRequest = useProjectStore((s) => s.humanInputRequest);
  const error = useProjectStore((s) => s.error);
  const errorRecoverable = useProjectStore((s) => s.errorRecoverable);
  const setProject = useProjectStore((s) => s.setProject);
  const reset = useProjectStore((s) => s.reset);

  const { sendMessage, disconnect } = useWebSocket(projectId);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem("dashboard-theme", theme);
  }, [theme]);

  const handleStart = useCallback(async () => {
    if (!requirementInput.trim()) return;
    setIsStarting(true);
    try {
      const result = await createProject(requirementInput.trim());
      setProject(result.projectId, requirementInput.trim());
      setRequirementInput("");
    } catch (e) {
      alert(`Failed to start project: ${e.message}`);
    } finally {
      setIsStarting(false);
    }
  }, [requirementInput, setProject]);

  const handleHumanResponse = useCallback(
    (data) => {
      sendMessage({ type: "human_response", data });
      useProjectStore.setState({ status: "running", humanInputRequest: null });
    },
    [sendMessage]
  );

  const handleCancel = useCallback(() => {
    sendMessage({ type: "cancel" });
  }, [sendMessage]);

  const handleResume = useCallback(async () => {
    if (!projectId) return;
    try {
      useProjectStore.setState({ status: "running", error: null, errorRecoverable: false });
      await resumeProject(projectId);
    } catch (e) {
      useProjectStore.setState({ status: "error", error: `Resume failed: ${e.message}` });
    }
  }, [projectId]);

  const handleNewProject = useCallback(() => {
    disconnect();
    reset();
  }, [disconnect, reset]);

  const landingMetrics = [
    { label: "Agents", value: "27", hint: "specialized roles" },
    { label: "Phases", value: "5", hint: "from brief to result" },
    { label: "Mode", value: wsConnected ? "Live" : "Ready", hint: "websocket-aware control room" },
  ];

  const overviewMetrics = [
    { label: "Project", value: projectId || "None", hint: "thread identifier" },
    { label: "Runtime", value: wsConnected ? "Connected" : "Offline", hint: "dashboard transport" },
    { label: "State", value: status.replace("_", " "), hint: "current execution mode" },
  ];

  return (
    <div className="app">
      <div className="app-shell">
        <header className="header">
          <div className="header-left">
            <div className="logo">
              <span className="logo-mark">A</span>
              <span className="logo-text">DEVTEAM</span>
            </div>
            <span className="header-divider" />
            <span className="header-label">mission control</span>
          </div>

          <div className="header-right">
            <button
              className="theme-toggle"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              <span className="theme-toggle-track">
                <span className={`theme-toggle-thumb theme-toggle-thumb--${theme}`} />
              </span>
              <span className="theme-toggle-label">
                {theme === "dark" ? "Dark" : "Light"}
              </span>
            </button>

            <div className="conn-indicator">
              <span className={`conn-dot ${wsConnected ? "live" : ""}`} />
              <span className="conn-label">{wsConnected ? "CONNECTED" : "OFFLINE"}</span>
            </div>

            {projectId && (
              <button className="btn btn-text" onClick={handleNewProject}>
                New Project
              </button>
            )}
          </div>
        </header>

        <main className="main">
          {!projectId ? (
            <div className="landing">
              <div className="landing-inner">
                <div className="landing-left">
                  <p className="landing-pre">AUTONOMOUS SOFTWARE STUDIO</p>
                  <h1 className="landing-title">
                    Ship product ideas
                    <br />
                    with a premium AI crew.
                  </h1>
                  <p className="landing-desc">
                    Turn one requirement into a coordinated delivery pipeline:
                    specification, architecture, planning, coding, review,
                    debugging, and final handoff in a polished control room.
                  </p>

                  <div className="landing-badges">
                    <span className="landing-badge">Strategy to code</span>
                    <span className="landing-badge">Live event stream</span>
                    <span className="landing-badge">Human checkpoint support</span>
                  </div>

                  <div className="hero-stats">
                    {landingMetrics.map((metric) => (
                      <div key={metric.label} className="hero-stat-card">
                        <span className="hero-stat-label">{metric.label}</span>
                        <span className="hero-stat-value">{metric.value}</span>
                        <span className="hero-stat-hint">{metric.hint}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="landing-right">
                  <div className="input-block">
                    <div className="input-block-top">
                      <label className="input-label">Project Brief</label>
                      <span className="input-caption">Ctrl+Enter to launch</span>
                    </div>

                    <textarea
                      value={requirementInput}
                      onChange={(e) => setRequirementInput(e.target.value)}
                      placeholder="Build a todo app with categories, due dates, and user authentication..."
                      rows={5}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleStart();
                      }}
                    />

                    <div className="input-actions">
                      <button
                        className="btn btn-accent"
                        onClick={handleStart}
                        disabled={!requirementInput.trim() || isStarting}
                      >
                        {isStarting ? "Initializing..." : "Launch Mission"}
                      </button>
                      <span className="input-shortcut">Instant graph kickoff</span>
                    </div>
                  </div>

                  <div className="templates">
                    <span className="templates-label">Starter Prompts</span>
                    {[
                      "Blog platform with comments and tags",
                      "E-commerce store with admin panel",
                      "Real-time chat app with rooms",
                    ].map((example) => (
                      <button
                        key={example}
                        className="template-btn"
                        onClick={() => setRequirementInput(example)}
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="dashboard">
              <div className="req-bar">
                <div className="req-bar-left">
                  <span className="req-label">Active Brief</span>
                  <span className="req-text">{requirement}</span>
                </div>

                <div className="req-bar-right">
                  <span className={`status-pill status--${status}`}>
                    {status === "running" && "RUNNING"}
                    {status === "waiting_input" && "AWAITING INPUT"}
                    {status === "complete" && "COMPLETE"}
                    {status === "error" && "ERROR"}
                    {status === "cancelled" && "CANCELLED"}
                    {status === "idle" && "IDLE"}
                  </span>

                  {status === "running" && (
                    <button className="btn btn-text btn-sm" onClick={handleCancel}>
                      Abort
                    </button>
                  )}

                  {status === "error" && errorRecoverable && (
                    <button className="btn btn-accent btn-sm" onClick={handleResume}>
                      Retry
                    </button>
                  )}
                </div>
              </div>

              <div className="overview-grid">
                {overviewMetrics.map((item) => (
                  <div key={item.label} className="overview-card">
                    <span className="overview-label">{item.label}</span>
                    <span className="overview-value">{item.value}</span>
                    <span className="overview-hint">{item.hint}</span>
                  </div>
                ))}
              </div>

              {status === "error" && error && (
                <div className="error-bar">
                  <span className="error-bar-label">ERROR</span>
                  <span className="error-bar-msg">{error}</span>
                  {errorRecoverable && (
                    <span className="error-bar-hint">
                      Checkpointed. Click retry to resume from the last good state.
                    </span>
                  )}
                </div>
              )}

              <PipelineVisualizer />

              <div className="dashboard-grid">
                <div className="dashboard-col">
                  <LogStream />
                </div>
                <div className="dashboard-col">
                  <OutputPanel />
                </div>
              </div>

              {humanInputRequest && (
                <HumanInputPanel
                  request={humanInputRequest}
                  onSubmit={handleHumanResponse}
                />
              )}

              <TokenBudgetBar />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
