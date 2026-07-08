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
      <main className="main">
        <div className="container">
          <div className="content-wrapper">
            <div className="hero-section">
              <h1 className="hero-title">Build with AI</h1>
              <p className="hero-desc">Turn your ideas into production-ready applications instantly</p>
            </div>

            <div className="input-section">
              <div className="input-container">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Describe what you want to build..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  className="main-input"
                  disabled={isLoading}
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className="submit-btn"
                  aria-label="Submit"
                >
                  {isLoading ? (
                    <span className="spinner"></span>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                      <polyline points="12 5 19 12 12 19"></polyline>
                    </svg>
                  )}
                </button>
              </div>
              <p className="input-help">Press Enter or click to submit</p>
            </div>

            <div className="features-grid">
              <div className="feature-card">
                <div className="feature-number">01</div>
                <h3 className="feature-title">Instant Creation</h3>
                <p className="feature-desc">Build your entire project in seconds</p>
              </div>
              <div className="feature-card">
                <div className="feature-number">02</div>
                <h3 className="feature-title">AI Engineers</h3>
                <p className="feature-desc">27 specialized AI agents collaborate seamlessly</p>
              </div>
              <div className="feature-card">
                <div className="feature-number">03</div>
                <h3 className="feature-title">Live Updates</h3>
                <p className="feature-desc">Watch your project come to life in real-time</p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
