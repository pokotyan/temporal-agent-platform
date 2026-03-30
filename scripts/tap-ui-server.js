#!/usr/bin/env node

/**
 * TAP UI Server — lightweight web dashboard for workflow management.
 * No external dependencies — uses Node.js built-in http module.
 *
 * API:
 *   GET  /api/workflows                    — list recent workflows
 *   GET  /api/workflows/:id                — workflow detail + step outputs
 *   POST /api/workflows                    — start a new workflow
 *   POST /api/workflows/:id/signal         — send signal to workflow
 *   POST /api/workflows/:id/cancel         — cancel workflow
 *   GET  /api/services                     — TAP service status
 *   GET  /api/workflow-templates           — list workflow YAML names
 *   GET  /api/workflow-templates/:name     — load workflow definition (raw YAML)
 *   PUT  /api/workflow-templates/:name     — save workflow definition (raw YAML)
 *   DELETE /api/workflow-templates/:name   — delete workflow YAML
 *   GET  /api/agents                       — list available agent names
 *   GET  /api/workflows/:id/steps          — list child step workflows
 *   GET  /api/logs                         — list log service names
 *   GET  /api/logs/:service                — tail log lines
 *
 * Static files served from ../ui/
 */

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LOGS_DIR = path.join(os.homedir(), '.tap', 'logs');
const WORKFLOWS_DIR = path.resolve(__dirname, '..', 'resources', 'workflows');

const { loadWorkflowConfig } = require(path.resolve(__dirname, '..', 'packages', 'shared', 'dist', 'yaml', 'loader'));
const { ScheduleOverlapPolicy } = require('@temporalio/client');

function makeSlug(text, maxLen = 25) {
  return text
    .slice(0, maxLen)
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}

const overlapPolicyMap = {
  skip: ScheduleOverlapPolicy.Skip,
  cancel_other: ScheduleOverlapPolicy.CancelOther,
  allow_all: ScheduleOverlapPolicy.AllowAll,
};

const UI_DIR = path.resolve(__dirname, '..', 'ui');
const PORT = parseInt(process.env.TAP_UI_PORT || '8234', 10);

// ── Temporal Client (lazy, with reconnect) ──

let _client = null;
async function getClient() {
  if (_client) {
    try {
      await _client.connection.ensureConnected();
      return _client;
    } catch {
      _client = null;
    }
  }
  const { Connection, Client } = require('@temporalio/client');
  const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
  const connection = await Connection.connect({ address });
  _client = new Client({ connection });
  return _client;
}

// ── API Handlers ──

async function listWorkflows() {
  const client = await getClient();
  const workflows = client.workflow.list();
  const results = [];
  let count = 0;
  for await (const wf of workflows) {
    if (count >= 50) break;
    count++;
    results.push({
      workflowId: wf.workflowId,
      type: wf.type,
      workflowName: wf.memo?.workflowName ?? null,
      status: wf.status?.name || 'UNKNOWN',
      startTime: wf.startTime?.toISOString(),
      closeTime: wf.closeTime?.toISOString(),
    });
  }
  return results;
}

async function getWorkflowDetail(workflowId) {
  const client = await getClient();
  const handle = client.workflow.getHandle(workflowId);
  const desc = await handle.describe();

  const detail = {
    workflowId,
    type: desc.type,
    workflowName: desc.memo?.workflowName ?? null,
    status: desc.status?.name,
    startTime: desc.startTime?.toISOString(),
    closeTime: desc.closeTime?.toISOString(),
    state: null,
    stepOutputs: null,
  };

  if (desc.status?.name === 'RUNNING') {
    try {
      detail.state = await handle.query('status');
    } catch {
      /* query not supported */
    }
  }

  try {
    detail.stepOutputs = await handle.query('stepOutputs');
  } catch {
    /* not available */
  }

  return detail;
}

async function startWorkflow(body) {
  const client = await getClient();
  const workflowName = body.workflow || 'default';

  const workflowPath = path.resolve(__dirname, '..', 'resources', 'workflows', `${workflowName}.yaml`);
  if (!fs.existsSync(workflowPath)) {
    const available = fs
      .readdirSync(WORKFLOWS_DIR)
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => f.replace('.yaml', ''));
    throw new Error(`Workflow '${workflowName}' not found. Available: ${available.join(', ')}`);
  }

  const workflowConfig = loadWorkflowConfig(workflowPath);
  // Task comes from YAML definition; body.task is a fallback for manual overrides
  const task = workflowConfig.task || body.task || '';
  const cronFromYaml = workflowConfig.temporal?.schedule?.cron;

  if (cronFromYaml) {
    const slug = makeSlug(task || workflowName);
    const scheduleId = `tap-sched-${Date.now()}-${slug}`;
    const overlapKey = workflowConfig.temporal?.schedule?.overlapPolicy;
    const overlapPolicy = overlapPolicyMap[overlapKey] ?? ScheduleOverlapPolicy.Skip;
    await client.schedule.create({
      scheduleId,
      spec: { cronExpressions: [cronFromYaml] },
      policies: { overlap: overlapPolicy },
      action: {
        type: 'startWorkflow',
        workflowType: 'pieceWorkflow',
        taskQueue: 'orchestrator',
        args: [workflowConfig, task, { workflowSessionId: scheduleId }],
        memo: { workflowName },
      },
      state: { note: workflowName },
    });
    return { scheduleId, scheduled: true, cron: cronFromYaml };
  }

  const workflowId = `tap-${Date.now()}-${makeSlug(task || workflowName, 30)}`;
  const handle = await client.workflow.start('pieceWorkflow', {
    taskQueue: 'orchestrator',
    workflowId,
    args: [workflowConfig, task, { workflowSessionId: workflowId }],
    memo: { workflowName },
  });

  return { workflowId: handle.workflowId };
}

async function signalWorkflow(workflowId, body) {
  const client = await getClient();
  const handle = client.workflow.getHandle(workflowId);
  await handle.signal('userInput', body.message);
  return { ok: true };
}

async function cancelWorkflow(workflowId) {
  const client = await getClient();
  const handle = client.workflow.getHandle(workflowId);
  await handle.cancel();
  return { ok: true };
}

async function deleteWorkflowExecution(workflowId) {
  const client = await getClient();
  // Also delete child step workflows
  const prefix = `${workflowId}-step-`;
  const childIds = [];
  for await (const wf of client.workflow.list()) {
    if (wf.workflowId.startsWith(prefix)) {
      childIds.push(wf.workflowId);
    }
  }
  for (const childId of childIds) {
    try {
      await client.workflowService.deleteWorkflowExecution({
        namespace: 'default',
        workflowExecution: { workflowId: childId },
      });
    } catch {
      /* already deleted or not found */
    }
  }
  await client.workflowService.deleteWorkflowExecution({
    namespace: 'default',
    workflowExecution: { workflowId },
  });
  return { ok: true };
}

async function getServices() {
  const { getStatus } = require('./tap-service-manager');
  return getStatus();
}

async function getWorkflowTemplates() {
  const files = fs.readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith('.yaml'));
  return files.map((f) => {
    const name = f.replace('.yaml', '');
    const filePath = path.join(WORKFLOWS_DIR, f);
    try {
      const config = loadWorkflowConfig(filePath);
      return {
        name,
        description: config.description || '',
        task: config.task || '',
        loop: config.maxIterations === 0,
        scheduleCron: config.temporal?.schedule?.cron || null,
      };
    } catch {
      return { name, description: '', loop: false, scheduleCron: null };
    }
  });
}

function getWorkflowDefinition(name) {
  const safe = path.basename(name);
  const filePath = path.join(WORKFLOWS_DIR, `${safe}.yaml`);
  if (!fs.existsSync(filePath)) throw new Error(`Workflow '${name}' not found`);
  return fs.readFileSync(filePath, 'utf8');
}

async function saveWorkflowDefinition(name, yamlContent) {
  const safe = path.basename(name);
  if (!safe || safe.includes('..')) throw new Error('Invalid workflow name');
  const filePath = path.join(WORKFLOWS_DIR, `${safe}.yaml`);
  fs.writeFileSync(filePath, yamlContent, 'utf8');

  // Sync cron to any existing Temporal Schedule that uses this workflow
  let synced = false;
  try {
    const config = loadWorkflowConfig(filePath);
    const newCron = config.temporal?.schedule?.cron || null;
    const newOverlap = overlapPolicyMap[config.temporal?.schedule?.overlapPolicy] ?? ScheduleOverlapPolicy.Skip;
    const client = await getClient();

    for await (const s of client.schedule.list()) {
      const handle = client.schedule.getHandle(s.scheduleId);
      let desc;
      try {
        desc = await handle.describe();
      } catch {
        continue;
      }
      const note = desc.state?.note || '';
      if (note !== safe && note !== config.name) continue;

      if (newCron) {
        await handle.update((prev) => ({
          ...prev,
          spec: { cronExpressions: [newCron] },
          policies: { ...prev.policies, overlap: newOverlap },
          action: {
            ...prev.action,
            args: [config, config.task || '', { workflowSessionId: s.scheduleId }],
            memo: { workflowName: config.name },
          },
        }));
        synced = true;
      } else {
        // cron removed from YAML → delete the schedule
        await handle.delete();
        synced = true;
      }
    }
  } catch {
    // Schedule sync is best-effort; YAML save already succeeded
  }

  return { saved: safe, scheduleSynced: synced };
}

function deleteWorkflowDefinition(name) {
  const safe = path.basename(name);
  const filePath = path.join(WORKFLOWS_DIR, `${safe}.yaml`);
  if (!fs.existsSync(filePath)) throw new Error(`Workflow '${name}' not found`);
  fs.unlinkSync(filePath);
  return { deleted: safe };
}

// ── Schedule Handlers ──

async function listSchedules() {
  const client = await getClient();
  const results = [];
  for await (const s of client.schedule.list()) {
    // list() does not include state.note; fetch via describe()
    let note = '';
    try {
      const desc = await client.schedule.getHandle(s.scheduleId).describe();
      note = desc.state?.note || desc.action?.args?.[0]?.name || '';
    } catch {
      /* fall back to list data */
    }

    results.push({
      scheduleId: s.scheduleId,
      paused: s.state?.paused ?? false,
      cronExpressions: s.spec?.cronExpressions ?? [],
      note,
      nextActionTimes: (s.info?.nextActionTimes ?? [])
        .slice(0, 3)
        .map((d) => (d instanceof Date ? d.toISOString() : d)),
      recentActions: (s.info?.recentActions ?? []).slice(-3).map((a) => ({
        scheduledAt: a.scheduledAt instanceof Date ? a.scheduledAt.toISOString() : a.scheduledAt,
        startedAt: a.startedAt instanceof Date ? a.startedAt.toISOString() : a.startedAt,
      })),
    });
  }
  return results;
}

async function createSchedule(body) {
  const client = await getClient();
  const { task, workflow: workflowName = 'default', cronExpression, label } = body;
  if (!task) throw new Error('task is required');
  if (!cronExpression) throw new Error('cronExpression is required');

  const workflowPath = path.resolve(__dirname, '..', 'resources', 'workflows', `${workflowName}.yaml`);
  if (!fs.existsSync(workflowPath)) throw new Error(`Workflow '${workflowName}' not found`);

  const workflowConfig = loadWorkflowConfig(workflowPath);
  const scheduleId = `tap-sched-${Date.now()}-${makeSlug(label || task)}`;
  const overlapPolicy =
    overlapPolicyMap[workflowConfig.temporal?.schedule?.overlapPolicy] ?? ScheduleOverlapPolicy.Skip;

  await client.schedule.create({
    scheduleId,
    spec: { cronExpressions: [cronExpression] },
    policies: { overlap: overlapPolicy },
    action: {
      type: 'startWorkflow',
      workflowType: 'pieceWorkflow',
      taskQueue: 'orchestrator',
      args: [workflowConfig, task, { workflowSessionId: scheduleId }],
      memo: { workflowName: label || workflowName },
    },
    state: { note: label || workflowName },
  });

  return { scheduleId };
}

async function deleteSchedule(scheduleId) {
  const client = await getClient();
  await client.schedule.getHandle(scheduleId).delete();
  return { ok: true };
}

async function pauseSchedule(scheduleId, pause) {
  const client = await getClient();
  const handle = client.schedule.getHandle(scheduleId);
  if (pause) {
    await handle.pause('Paused via TAP UI');
  } else {
    await handle.unpause('Resumed via TAP UI');
  }
  return { ok: true };
}

async function triggerSchedule(scheduleId) {
  const client = await getClient();
  await client.schedule.getHandle(scheduleId).trigger();
  return { ok: true };
}

function listSkills() {
  const searchDirs = [path.join(os.homedir(), '.claude', 'skills'), path.resolve(__dirname, '..', '.claude', 'skills')];
  const seen = new Set();
  for (const dir of searchDirs) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && !seen.has(entry.name)) {
          const skillFile = path.join(dir, entry.name, 'SKILL.md');
          if (fs.existsSync(skillFile)) seen.add(entry.name);
        }
      }
    } catch {
      /* dir doesn't exist */
    }
  }
  return [...seen].sort();
}

function listAgents() {
  const agentsDir = path.resolve(__dirname, '..', 'resources', 'agents', 'default');
  try {
    return fs
      .readdirSync(agentsDir)
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => f.replace('.yaml', ''));
  } catch {
    return ['planner', 'coder', 'reviewer', 'supervisor'];
  }
}

async function getWorkflowSteps(parentWorkflowId) {
  const client = await getClient();
  const prefix = `${parentWorkflowId}-step-`;
  const results = [];
  for await (const wf of client.workflow.list()) {
    if (!wf.workflowId.startsWith(prefix)) continue;
    // Parse "tap-xxx-step-plan-1" → step=plan, iteration=1
    const suffix = wf.workflowId.slice(prefix.length); // e.g. "plan-1"
    const lastDash = suffix.lastIndexOf('-');
    const step = lastDash >= 0 ? suffix.slice(0, lastDash) : suffix;
    const iteration = lastDash >= 0 ? parseInt(suffix.slice(lastDash + 1), 10) : 0;
    results.push({
      workflowId: wf.workflowId,
      step,
      iteration,
      status: wf.status?.name || 'UNKNOWN',
      startTime: wf.startTime?.toISOString(),
      closeTime: wf.closeTime?.toISOString(),
    });
  }
  results.sort((a, b) => a.iteration - b.iteration);
  return results;
}

function listLogFiles() {
  try {
    const files = fs.readdirSync(LOGS_DIR).filter((f) => f.endsWith('.log'));
    // Return unique service names derived from filenames like "orchestrator-worker-2026-03-30.log"
    const services = new Set();
    for (const f of files) {
      // Remove date suffix: strip "-YYYY-MM-DD.log"
      const m = f.match(/^(.+)-\d{4}-\d{2}-\d{2}\.log$/);
      if (m) services.add(m[1]);
    }
    return [...services].sort();
  } catch {
    return [];
  }
}

function getLogLines(serviceName, lines = 200) {
  const today = new Date().toISOString().slice(0, 10);
  const logPath = path.join(LOGS_DIR, `${serviceName}-${today}.log`);
  try {
    const data = fs.readFileSync(logPath, 'utf8');
    const allLines = data.split('\n');
    return { lines: allLines.slice(-lines), file: logPath };
  } catch {
    return { lines: [], file: logPath };
  }
}

// ── HTTP Server ──

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function serveStatic(res, urlPath) {
  const pathname = urlPath.split('?')[0]; // strip query string
  const filePath = path.join(UI_DIR, pathname === '/' ? 'index.html' : pathname);
  const safePath = path.resolve(filePath);
  if (!safePath.startsWith(UI_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const data = fs.readFileSync(safePath);
    const ext = path.extname(safePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    // SPA fallback: serve index.html for navigation routes (no file extension)
    // Don't fallback for asset requests (.js, .css, .png, etc.) — return 404 instead
    const ext = path.extname(pathname);
    if (!ext) {
      try {
        const indexPath = path.join(UI_DIR, 'index.html');
        const data = fs.readFileSync(indexPath);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
        return;
      } catch {
        /* fall through to 404 */
      }
    }
    res.writeHead(404);
    res.end('Not Found');
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

function jsonResponse(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const segments = url.pathname.replace('/api/', '').split('/').filter(Boolean);

  try {
    // GET /api/workflows
    if (req.method === 'GET' && segments[0] === 'workflows' && !segments[1]) {
      return jsonResponse(res, 200, await listWorkflows());
    }

    // GET /api/workflows/:id
    if (req.method === 'GET' && segments[0] === 'workflows' && segments[1] && !segments[2]) {
      return jsonResponse(res, 200, await getWorkflowDetail(segments[1]));
    }

    // POST /api/workflows
    if (req.method === 'POST' && segments[0] === 'workflows' && !segments[1]) {
      const body = await readBody(req);
      return jsonResponse(res, 201, await startWorkflow(body));
    }

    // POST /api/workflows/:id/signal
    if (req.method === 'POST' && segments[0] === 'workflows' && segments[2] === 'signal') {
      const body = await readBody(req);
      return jsonResponse(res, 200, await signalWorkflow(segments[1], body));
    }

    // POST /api/workflows/:id/cancel
    if (req.method === 'POST' && segments[0] === 'workflows' && segments[2] === 'cancel') {
      return jsonResponse(res, 200, await cancelWorkflow(segments[1]));
    }

    // DELETE /api/workflows/:id
    if (req.method === 'DELETE' && segments[0] === 'workflows' && segments[1] && !segments[2]) {
      return jsonResponse(res, 200, await deleteWorkflowExecution(decodeURIComponent(segments[1])));
    }

    // GET /api/services
    if (req.method === 'GET' && segments[0] === 'services') {
      return jsonResponse(res, 200, await getServices());
    }

    // GET /api/workflow-templates
    if (req.method === 'GET' && segments[0] === 'workflow-templates' && !segments[1]) {
      return jsonResponse(res, 200, await getWorkflowTemplates());
    }

    // GET /api/workflows/:id/steps
    if (req.method === 'GET' && segments[0] === 'workflows' && segments[2] === 'steps') {
      return jsonResponse(res, 200, await getWorkflowSteps(segments[1]));
    }

    // GET /api/logs — list available services with logs
    if (req.method === 'GET' && segments[0] === 'logs' && !segments[1]) {
      return jsonResponse(res, 200, listLogFiles());
    }

    // GET /api/logs/:service?lines=200
    if (req.method === 'GET' && segments[0] === 'logs' && segments[1]) {
      const lines = parseInt(url.searchParams.get('lines') || '200', 10);
      return jsonResponse(res, 200, getLogLines(segments[1], lines));
    }

    // GET /api/workflow-templates/:name — load raw YAML
    if (req.method === 'GET' && segments[0] === 'workflow-templates' && segments[1]) {
      return jsonResponse(res, 200, { yaml: getWorkflowDefinition(decodeURIComponent(segments[1])) });
    }

    // PUT /api/workflow-templates/:name — save raw YAML
    if (req.method === 'PUT' && segments[0] === 'workflow-templates' && segments[1]) {
      const body = await readBody(req);
      return jsonResponse(res, 200, await saveWorkflowDefinition(decodeURIComponent(segments[1]), body.yaml));
    }

    // DELETE /api/workflow-templates/:name
    if (req.method === 'DELETE' && segments[0] === 'workflow-templates' && segments[1]) {
      return jsonResponse(res, 200, deleteWorkflowDefinition(decodeURIComponent(segments[1])));
    }

    // GET /api/agents
    if (req.method === 'GET' && segments[0] === 'agents') {
      return jsonResponse(res, 200, listAgents());
    }

    // GET /api/skills
    if (req.method === 'GET' && segments[0] === 'skills' && !segments[1]) {
      return jsonResponse(res, 200, listSkills());
    }

    // GET /api/schedules
    if (req.method === 'GET' && segments[0] === 'schedules' && !segments[1]) {
      return jsonResponse(res, 200, await listSchedules());
    }

    // POST /api/schedules
    if (req.method === 'POST' && segments[0] === 'schedules' && !segments[1]) {
      const body = await readBody(req);
      return jsonResponse(res, 201, await createSchedule(body));
    }

    // DELETE /api/schedules/:id
    if (req.method === 'DELETE' && segments[0] === 'schedules' && segments[1]) {
      return jsonResponse(res, 200, await deleteSchedule(decodeURIComponent(segments[1])));
    }

    // POST /api/schedules/:id/pause
    if (req.method === 'POST' && segments[0] === 'schedules' && segments[2] === 'pause') {
      const body = await readBody(req);
      return jsonResponse(res, 200, await pauseSchedule(decodeURIComponent(segments[1]), body.pause));
    }

    // POST /api/schedules/:id/trigger
    if (req.method === 'POST' && segments[0] === 'schedules' && segments[2] === 'trigger') {
      return jsonResponse(res, 200, await triggerSchedule(decodeURIComponent(segments[1])));
    }

    // DEBUG: GET /api/schedules/:id/debug
    if (req.method === 'GET' && segments[0] === 'schedules' && segments[2] === 'debug') {
      const client = await getClient();
      const desc = await client.schedule.getHandle(decodeURIComponent(segments[1])).describe();
      return jsonResponse(res, 200, {
        state: desc.state,
        actionType: desc.action?.type,
        actionArgs: desc.action?.args?.map((a, i) =>
          i === 0 ? { name: a?.name, keys: a ? Object.keys(a) : null } : typeof a,
        ),
        specCron: desc.spec?.cronExpressions,
        memo: desc.memo,
      });
    }

    jsonResponse(res, 404, { error: 'Not found' });
  } catch (err) {
    jsonResponse(res, 500, { error: err.message });
  }
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (req.url.startsWith('/api/')) {
    return handleApi(req, res);
  }

  // Serve workflow output files as rendered markdown
  if (req.url.startsWith('/outputs/')) {
    const id = decodeURIComponent(req.url.replace('/outputs/', '').split('?')[0]);
    const safe = path.basename(id);
    const outputPath = path.join(os.homedir(), '.tap', 'outputs', `${safe}.md`);
    try {
      const md = fs.readFileSync(outputPath, 'utf8');
      // Escape for safe embedding in a JS template literal
      const jsEscaped = md.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
      const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>TAP Output</title>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11/styles/github-dark.min.css">
<script src="https://cdn.jsdelivr.net/npm/highlight.js@11/lib/core.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/highlight.js@11/lib/languages/javascript.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/highlight.js@11/lib/languages/typescript.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/highlight.js@11/lib/languages/python.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/highlight.js@11/lib/languages/bash.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/highlight.js@11/lib/languages/yaml.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/highlight.js@11/lib/languages/json.min.js"></script>
<style>
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:900px;margin:0 auto;padding:2rem 1.5rem;background:#0d1117;color:#c9d1d9;line-height:1.6}
h1{color:#58a6ff;border-bottom:1px solid #21262d;padding-bottom:.5rem;font-size:1.8em}
h2{color:#79c0ff;border-bottom:1px solid #21262d;padding-bottom:.3rem;margin-top:2rem;font-size:1.4em}
h3{color:#a5d6ff;font-size:1.15em}
a{color:#58a6ff;text-decoration:none}
a:hover{text-decoration:underline}
p{margin:.8em 0}
code{font-family:'SF Mono','Fira Code',Consolas,monospace;font-size:.85em;background:#161b22;padding:.2em .4em;border-radius:4px}
pre{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:1rem;overflow-x:auto;line-height:1.5}
pre code{background:none;padding:0;font-size:.85em}
blockquote{border-left:3px solid #3b82f6;margin:1em 0;padding:.5em 1em;color:#8b949e;background:#161b22;border-radius:0 6px 6px 0}
table{border-collapse:collapse;width:100%;margin:1em 0}
th,td{border:1px solid #30363d;padding:.5em .8em;text-align:left}
th{background:#161b22;color:#79c0ff}
tr:nth-child(even){background:#0d1117}
hr{border:none;border-top:1px solid #21262d;margin:2rem 0}
ul,ol{padding-left:1.5em}
li{margin:.3em 0}
strong{color:#e6edf3}
img{max-width:100%;border-radius:6px}
.meta{color:#8b949e;font-size:.85em;margin-bottom:1.5rem}
</style>
</head><body>
<div id="content"></div>
<script>
marked.setOptions({
  highlight:function(code,lang){
    if(lang&&hljs.getLanguage(lang)){try{return hljs.highlight(code,{language:lang}).value}catch{}}
    return code;
  },
  breaks:false,gfm:true
});
document.getElementById('content').innerHTML=marked.parse(\`${jsEscaped}\`);
</script>
</body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not Found</title><style>body{font-family:-apple-system,sans-serif;max-width:600px;margin:4rem auto;padding:0 1rem;background:#0d1117;color:#c9d1d9;text-align:center}h1{color:#f85149}</style></head><body><h1>Not Found</h1><p>This workflow output has not been generated yet.</p></body></html>',
      );
    }
    return;
  }

  serveStatic(res, req.url);
});

server.listen(PORT, () => {
  console.log(`[TAP UI] http://localhost:${PORT}`);
});
