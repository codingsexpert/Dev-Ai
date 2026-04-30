/**
 * lib/api.js — REST API Client
 * 
 * Simple fetch wrapper for the Express server endpoints.
 * WebSocket handles real-time; this handles request-response.
 */

function getBaseUrl() {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  if (typeof window !== "undefined") {
    const { protocol, hostname, port } = window.location;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      // When the dashboard is served by Vite, prefer same-origin proxying.
      if (port === "5173") return "/api";
      return "http://localhost:3000/api";
    }
    return `${protocol}//${hostname.replace(/^www\./, "")}/api`;
  }

  return "http://localhost:3000/api";
}

const BASE_URL = getBaseUrl();

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  const raw = await res.text();
  let data = null;

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(raw || `HTTP ${res.status}`);
  }

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  return data;
}

/** Start a new project */
export async function createProject(requirement, tokenBudget = 2.0) {
  return request("/projects", {
    method: "POST",
    body: JSON.stringify({ requirement, tokenBudget }),
  });
}

/** List active projects */
export async function listProjects() {
  return request("/projects");
}

/** Get project details + state */
export async function getProject(projectId) {
  return request(`/projects/${projectId}`);
}

/** Resume a checkpointed project */
export async function resumeProject(projectId) {
  return request(`/projects/${projectId}/resume`, { method: "POST" });
}

/** Cancel a running project */
export async function cancelProject(projectId) {
  return request(`/projects/${projectId}/cancel`, { method: "POST" });
}

/** Get sandbox info */
export async function getSandbox(projectId) {
  return request(`/projects/${projectId}/sandbox`);
}

/** Read a file from the sandbox */
export async function readFile(projectId, filePath) {
  return request(`/projects/${projectId}/files/${filePath}`);
}

/** Health check */
export async function healthCheck() {
  return request("/health");
}
