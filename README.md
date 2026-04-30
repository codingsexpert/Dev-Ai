# AI Dev Team

Multi-agent software development system built with LangGraph, Gemini, Express, WebSocket, and a React dashboard.

## Current State

- CLI pipeline exists through the planning and dev-loop stages
- Web dashboard exists for starting runs and streaming progress
- Sandbox manager supports Docker mode and local-only fallback mode
- Mock wiring tests are available for graph, validator, sandbox, and dev loop

## Project Structure

```text
.
├── src/                 # LangGraph state, nodes, agents, CLI entry
├── server/              # REST API + WebSocket server
├── dashboard/           # React + Vite dashboard
├── tests/               # Mock and integration-style test scripts
└── sandboxes/           # Generated project sandboxes
```

## Prerequisites

- Node.js 18+
- Gemini API key for real LLM runs
- Docker optional, but recommended for full sandbox isolation

## Setup

```bash
npm install
cd dashboard && npm install && cd ..
cp .env.example .env
```

Add your Gemini key in `.env`.

## Run

### Dashboard mode

```bash
npm run dev
```

This starts:

- backend server on `http://localhost:3000`
- dashboard on `http://localhost:5173`

### CLI mode

```bash
node src/index.js "Build a todo app with categories and due dates"
```

Or interactive mode:

```bash
node src/index.js
```

### Docker mode

```bash
docker compose up --build
```

Then open:

- `http://localhost:5173` for the dashboard
- `http://localhost:3000/api/health` for backend health

## Test Commands

```bash
npm run test:graph
npm run test:validator
npm run test:sandbox
npm run test:devloop
npm run test:all:mock

## Deploy On Render

This repo includes a [`render.yaml`](/Users/MukeshSingh/Desktop/AIDevFinal/render.yaml) blueprint for:

- `ai-dev-team-api` as a Render Web Service
- `ai-dev-team-dashboard` as a Render Static Site

Required env vars after import:

- Backend:
  - `GEMINI_API_KEY`
  - `FRONTEND_URL=https://your-dashboard-name.onrender.com`
- Frontend:
  - `VITE_API_URL=https://your-api-name.onrender.com/api`
  - `VITE_WS_URL=wss://your-api-name.onrender.com`

Recommended deploy flow:

1. Push repo to GitHub.
2. In Render, create a Blueprint using this repo.
3. Set backend `GEMINI_API_KEY`.
4. Deploy backend and note its `.onrender.com` URL.
5. Set frontend `VITE_API_URL` and `VITE_WS_URL` using that backend URL.
6. Set backend `FRONTEND_URL` using the frontend URL and redeploy once.
```

## Notes

- If Docker is unavailable, sandbox tests now run in local-only mode.
- Redis checkpointing is optional. Without `REDIS_URL`, the app falls back to in-memory state.
- Generated sandboxes are ignored by git via root `.gitignore`.
