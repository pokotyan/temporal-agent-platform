import type {
  LogResponse,
  Schedule,
  ServiceStatus,
  StepInfo,
  WorkflowDetail,
  WorkflowSummary,
  WorkflowTemplate,
} from './types';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`/api${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

// ── Workflows ──

export function listWorkflows() {
  return request<WorkflowSummary[]>('GET', '/workflows');
}

export function getWorkflow(id: string) {
  return request<WorkflowDetail>('GET', `/workflows/${id}`);
}

export function getWorkflowSteps(id: string) {
  return request<StepInfo[]>('GET', `/workflows/${id}/steps`);
}

export function startWorkflow(workflow: string) {
  return request<{ workflowId?: string; scheduled?: boolean }>('POST', '/workflows', { workflow });
}

export function signalWorkflow(id: string, message: string) {
  return request<void>('POST', `/workflows/${id}/signal`, { message });
}

export function cancelWorkflow(id: string) {
  return request<void>('POST', `/workflows/${id}/cancel`);
}

export function deleteWorkflow(id: string) {
  return request<void>('DELETE', `/workflows/${encodeURIComponent(id)}`);
}

// ── Templates ──

export function listTemplates() {
  return request<WorkflowTemplate[]>('GET', '/workflow-templates');
}

export function loadTemplate(name: string) {
  return request<{ yaml: string }>('GET', `/workflow-templates/${encodeURIComponent(name)}`);
}

export function saveTemplate(name: string, yaml: string) {
  return request<void>('PUT', `/workflow-templates/${encodeURIComponent(name)}`, { yaml });
}

export function deleteTemplate(name: string) {
  return request<void>('DELETE', `/workflow-templates/${encodeURIComponent(name)}`);
}

// ── Services ──

export function getServices() {
  return request<Record<string, ServiceStatus>>('GET', '/services');
}

// ── Agents & Skills ──

export function listAgents() {
  return request<string[]>('GET', '/agents');
}

export function listSkills() {
  return request<string[]>('GET', '/skills');
}

// ── Schedules ──

export function listSchedules() {
  return request<Schedule[]>('GET', '/schedules');
}

export function createSchedule(body: { workflow: string; cron: string }) {
  return request<void>('POST', '/schedules', body);
}

export function deleteSchedule(id: string) {
  return request<void>('DELETE', `/schedules/${encodeURIComponent(id)}`);
}

export function pauseSchedule(id: string, pause: boolean) {
  return request<void>('POST', `/schedules/${encodeURIComponent(id)}/pause`, { pause });
}

export function triggerSchedule(id: string) {
  return request<void>('POST', `/schedules/${encodeURIComponent(id)}/trigger`);
}

// ── Logs ──

export function listLogServices() {
  return request<string[]>('GET', '/logs');
}

export function fetchLogs(service: string, lines = 300) {
  return request<LogResponse>('GET', `/logs/${encodeURIComponent(service)}?lines=${lines}`);
}
