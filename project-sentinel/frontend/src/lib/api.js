// Thin fetch wrapper around the Project Sentinel FastAPI backend.
// In dev, Vite proxies /api, /uploads and /satellite-cache to :8000
// (see vite.config.js) so these calls use relative paths only.

async function request(path, options = {}) {
  const res = await fetch(path, options);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      /* response wasn't JSON */
    }
    throw new Error(`${res.status} ${detail}`);
  }
  return res.json();
}

export function listProjects() {
  return request("/api/projects");
}

export function getProject(id) {
  return request(`/api/projects/${id}`);
}

export function getRiskBreakdown(id) {
  return request(`/api/projects/${id}/risk-breakdown`);
}

export function getSatelliteChangeDetection(id) {
  return request(`/api/satellite/${id}/change-detection`);
}

export function getWeather(id) {
  return request(`/api/weather/${id}`);
}

export function getProjectPhotos(id) {
  return request(`/api/photos/${id}`);
}

export function classifyPhoto({ file, projectId, reportedProgressPct, updateProject }) {
  const form = new FormData();
  form.append("file", file);
  form.append("project_id", projectId);
  if (reportedProgressPct != null) {
    form.append("reported_progress_pct", String(reportedProgressPct));
  }
  form.append("update_project", updateProject ? "true" : "false");
  return request("/api/photos/classify", { method: "POST", body: form });
}

export function getAssetHealth(projectId) {
  return request(`/api/assets/AST-${projectId}/health?project_id=${projectId}`);
}

// PNG of the PAIMANA report page this project's reported figures come from,
// with the project's row highlighted.
export function sourcePageUrl(id) {
  return `/api/projects/${id}/source-page`;
}

// Simulated: drafts the clarification notice; nothing is sent or stored.
export function escalateProject(id) {
  return request(`/api/projects/${id}/escalate`, { method: "POST" });
}
