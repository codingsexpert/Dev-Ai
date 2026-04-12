/**
 * PipelineVisualizer.jsx
 * 
 * Horizontal phase blocks with node dots inside.
 * No emojis. Uses color coding: idle=dim, active=pulse, done=accent.
 */

import useProjectStore, {
  PIPELINE_PHASES,
  NODE_LABELS,
} from "../store/projectStore";

export default function PipelineVisualizer() {
  const completedNodes = useProjectStore((s) => s.completedNodes);
  const activeNode = useProjectStore((s) => s.activeNode);
  const currentPhase = useProjectStore((s) => s.currentPhase);

  const phases = Object.entries(PIPELINE_PHASES);

  return (
    <div className="pipeline">
      <div className="pipeline-track">
        {phases.map(([phaseKey, phase], phaseIdx) => {
          const isActivePhase = currentPhase === phaseKey;
          const phaseCompleted = phase.nodes.every((n) =>
            completedNodes.includes(n)
          );
          const hasCompletedNode = phase.nodes.some((n) =>
            completedNodes.includes(n)
          );

          let phaseClass = "phase--idle";
          if (phaseCompleted) phaseClass = "phase--done";
          else if (isActivePhase || hasCompletedNode) phaseClass = "phase--active";

          return (
            <div key={phaseKey} className="pipeline-segment">
              <div className={`phase-block ${phaseClass}`}>
                <div className="phase-top">
                  <span className="phase-num">{String(phaseIdx + 1).padStart(2, "0")}</span>
                  <span className="phase-name">{phase.label}</span>
                </div>
                <div className="phase-dots">
                  {phase.nodes.map((nodeName) => {
                    const isActive = nodeName === activeNode;
                    const isDone = completedNodes.includes(nodeName);

                    let dotClass = "dot--idle";
                    if (isActive) dotClass = "dot--active";
                    else if (isDone) dotClass = "dot--done";

                    return (
                      <div
                        key={nodeName}
                        className={`phase-dot ${dotClass}`}
                        title={NODE_LABELS[nodeName] || nodeName}
                      >
                        <span className="dot-pip" />
                      </div>
                    );
                  })}
                </div>
              </div>
              {phaseIdx < phases.length - 1 && (
                <div className={`phase-connector ${phaseCompleted ? "connector--done" : ""}`}>
                  <span className="connector-line" />
                  <span className="connector-arrow" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
