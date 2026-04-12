/**
 * TokenBudgetBar.jsx — Token Budget Tracker
 * No emojis. Compact bottom bar with progress and numbers.
 */

import useProjectStore from "../store/projectStore";

export default function TokenBudgetBar() {
  const tokenUsage = useProjectStore((s) => s.tokenUsage);
  const tokenBudget = useProjectStore((s) => s.tokenBudget);

  const cost = tokenUsage?.estimatedCost || 0;
  const totalTokens = (tokenUsage?.totalInput || 0) + (tokenUsage?.totalOutput || 0);
  const callCount = tokenUsage?.calls?.length || 0;
  const pct = tokenBudget > 0 ? Math.min((cost / tokenBudget) * 100, 100) : 0;

  const level = pct > 90 ? "danger" : pct > 70 ? "warn" : "ok";

  return (
    <div className="token-bar">
      <span className="token-bar-label">BUDGET</span>
      <div className="token-bar-track">
        <div className={`token-bar-fill token-bar-fill--${level}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="token-bar-cost">
        ${cost.toFixed(4)} / ${tokenBudget.toFixed(2)}
      </span>
      <span className="token-bar-meta">
        {callCount} calls &middot; {totalTokens.toLocaleString()} tok
      </span>
    </div>
  );
}
