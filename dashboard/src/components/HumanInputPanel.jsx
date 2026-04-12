/**
 * HumanInputPanel.jsx — Human-in-the-Loop
 * No emojis. Clean, urgent styling with border accent.
 */

import { useState } from "react";

export default function HumanInputPanel({ request, onSubmit }) {
  const [answer, setAnswer] = useState("");
  const [escalationChoice, setEscalationChoice] = useState(null);
  const [guidance, setGuidance] = useState("");

  if (!request) return null;

  if (request.type === "pm_clarification") {
    return (
      <div className="human-panel">
        <div className="human-head">
          <span className="human-tag">INPUT REQUIRED</span>
          <span className="human-title">PM Agent needs clarification</span>
        </div>
        <div className="human-body">
          <div className="question-list">
            {request.questions.map((q, i) => (
              <div key={i} className="question-row">
                <span className="question-num">{String(i + 1).padStart(2, "0")}</span>
                <span className="question-text">{q}</span>
              </div>
            ))}
          </div>
          <div className="answer-block">
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Type your answers here..."
              rows={4}
              autoFocus
            />
            <button
              className="btn btn-accent"
              onClick={() => {
                if (answer.trim()) {
                  onSubmit({ type: "pm_answers", answers: answer.trim() });
                  setAnswer("");
                }
              }}
              disabled={!answer.trim()}
            >
              SUBMIT
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (request.type === "escalation") {
    return (
      <div className="human-panel human-panel--danger">
        <div className="human-head">
          <span className="human-tag human-tag--danger">ESCALATION</span>
          <span className="human-title">Agent requires human decision</span>
        </div>
        <div className="human-body">
          <div className="escalation-ctx">
            {request.task && (
              <div className="ctx-row">
                <span className="ctx-label">TASK</span>
                <span className="ctx-value">{request.task.title || request.task.taskId}</span>
              </div>
            )}
            {request.error && (
              <div className="ctx-row">
                <span className="ctx-label">ERROR</span>
                <pre className="ctx-error">{request.error}</pre>
              </div>
            )}
          </div>

          <div className="escalation-choices">
            <button
              className={`choice-btn ${escalationChoice === "guide" ? "choice--selected" : ""}`}
              onClick={() => setEscalationChoice("guide")}
            >
              <span className="choice-title">Provide guidance</span>
              <span className="choice-desc">Tell the coder how to fix it</span>
            </button>
            <button
              className={`choice-btn ${escalationChoice === "skip" ? "choice--selected" : ""}`}
              onClick={() => {
                setEscalationChoice("skip");
                onSubmit({ type: "escalation", choice: "skip" });
              }}
            >
              <span className="choice-title">Skip task</span>
              <span className="choice-desc">Move to the next task</span>
            </button>
            <button
              className={`choice-btn ${escalationChoice === "simplify" ? "choice--selected" : ""}`}
              onClick={() => {
                setEscalationChoice("simplify");
                onSubmit({ type: "escalation", choice: "simplify" });
              }}
            >
              <span className="choice-title">Simplify</span>
              <span className="choice-desc">Reduce feature scope</span>
            </button>
          </div>

          {escalationChoice === "guide" && (
            <div className="answer-block">
              <textarea
                value={guidance}
                onChange={(e) => setGuidance(e.target.value)}
                placeholder="Describe the fix..."
                rows={3}
                autoFocus
              />
              <button
                className="btn btn-accent"
                onClick={() => {
                  if (guidance.trim()) {
                    onSubmit({ type: "escalation", choice: "guide", guidance: guidance.trim() });
                    setGuidance("");
                    setEscalationChoice(null);
                  }
                }}
                disabled={!guidance.trim()}
              >
                SEND GUIDANCE
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
