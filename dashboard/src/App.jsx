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
          <div className="input-wrapper">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message..."
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
              {isLoading ? "..." : "Send"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
