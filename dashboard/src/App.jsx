import { useState, useCallback } from "react";

export default function App() {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSend = useCallback(async () => {
    if (!input.trim()) return;
    setIsLoading(true);
    try {
      // Add send logic here
      console.log("Sending:", input);
      setInput("");
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, [input]);

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <div className="logo">
            <div className="logo-icon">AI</div>
            <div className="logo-text">
              <h1>DevAI</h1>
              <p>Autonomous Development Studio</p>
            </div>
          </div>
        </div>
      </header>

      <main className="main">
        <div className="hero-section">
          <div className="hero-content">
            <h2 className="hero-title">Build Faster with AI</h2>
            <p className="hero-desc">Describe what you want to build and let our AI team handle the rest</p>
          </div>
        </div>

        <div className="container">
          <div className="input-section">
            <div className="input-wrapper">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Describe your project idea..."
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                className="input"
                disabled={isLoading}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="send-btn"
              >
                {isLoading ? (
                  <>
                    <span className="spinner"></span>
                    Processing...
                  </>
                ) : (
                  <>
                    <span className="send-icon">→</span>
                    Launch
                  </>
                )}
              </button>
            </div>
            <p className="input-hint">Press Enter or click Launch to start building</p>
          </div>

          <div className="features">
            <div className="feature-item">
              <div className="feature-icon">⚡</div>
              <div className="feature-text">
                <h3>Lightning Fast</h3>
                <p>Get your project built in minutes</p>
              </div>
            </div>
            <div className="feature-item">
              <div className="feature-icon">🤖</div>
              <div className="feature-text">
                <h3>AI Powered</h3>
                <p>27 specialized AI agents working together</p>
              </div>
            </div>
            <div className="feature-item">
              <div className="feature-icon">📊</div>
              <div className="feature-text">
                <h3>Real-time Updates</h3>
                <p>Watch your project build live</p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
