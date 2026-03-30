#!/usr/bin/env node

/**
 * TAP MCP Server — provides workflow management tools to Claude Code.
 *
 * Tools:
 *   tap_service_status  — Show status of TAP dev services
 *   tap_service_restart — Restart TAP dev services
 *   tap_run_workflow    — Start a workflow
 *   tap_workflow_status — Get workflow status or list recent workflows
 *   tap_signal_workflow — Send signal to a workflow
 *   tap_cancel_workflow — Cancel a workflow
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RESOURCES_DIR = path.join(PROJECT_ROOT, 'resources');

// Lazy-loaded Temporal client — invalidated on connection error for auto-reconnect
let _temporalClient = null;
async function getTemporalClient() {
  if (_temporalClient) {
    try {
      // Verify connection is still alive
      await _temporalClient.connection.ensureConnected();
      return _temporalClient;
    } catch {
      _temporalClient = null;
    }
  }
  const { Connection, Client } = require('@temporalio/client');
  const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
  const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
  const connection = await Connection.connect({ address });
  _temporalClient = new Client({ connection, namespace });
  return _temporalClient;
}

function getServiceManager() {
  return require('./tap-service-manager');
}

const TOOLS = [
  {
    name: 'tap_service_status',
    description: 'Show status of TAP dev services (Temporal server, orchestrator worker, agent worker)',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'tap_service_restart',
    description: 'Restart TAP dev service(s). Omit service to restart all.',
    inputSchema: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          enum: ['temporal-server', 'orchestrator-worker', 'agent-worker', 'tap-ui'],
          description: 'Service to restart. Omit to restart all.',
        },
      },
    },
  },
  {
    name: 'tap_run_workflow',
    description: 'Start a TAP workflow with a task description',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task description for the workflow' },
        workflow: { type: 'string', description: 'Workflow name (default: "default")', default: 'default' },
      },
      required: ['task'],
    },
  },
  {
    name: 'tap_workflow_status',
    description: 'Get status of a workflow by ID, or list recent workflows if no ID given',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID. Omit to list recent workflows.' },
      },
    },
  },
  {
    name: 'tap_signal_workflow',
    description: 'Send a signal (user input) to a running workflow',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID' },
        message: { type: 'string', description: 'Message to send as user input' },
      },
      required: ['workflowId', 'message'],
    },
  },
  {
    name: 'tap_cancel_workflow',
    description: 'Cancel a running workflow',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID to cancel' },
      },
      required: ['workflowId'],
    },
  },
];

async function handleServiceStatus() {
  const { getStatus } = getServiceManager();
  const statuses = await getStatus();
  const lines = [];
  for (const [name, status] of Object.entries(statuses)) {
    const icon = status.healthy ? '●' : '○';
    const state = status.healthy ? 'running' : 'stopped';
    const port = status.port ? ` :${status.port}` : '';
    const pid = status.pid ? ` (pid ${status.pid})` : '';
    const uptime = status.startedAt ? ` since ${status.startedAt}` : '';
    lines.push(`${icon} ${name}${port} — ${state}${pid}${uptime}`);
  }
  return lines.join('\n');
}

async function handleServiceRestart(args) {
  const { startService, stopService, startAll, stopAll } = getServiceManager();
  if (args.service) {
    await stopService(args.service);
    await startService(args.service);
    return `Restarted ${args.service}`;
  } else {
    await stopAll(false);
    await startAll();
    return 'Restarted all services';
  }
}

async function handleRunWorkflow(args) {
  const client = await getTemporalClient();
  const workflowName = args.workflow || 'default';
  const workflowPath = path.join(RESOURCES_DIR, `workflows/${workflowName}.yaml`);

  if (!fs.existsSync(workflowPath)) {
    const available = fs
      .readdirSync(path.join(RESOURCES_DIR, 'workflows'))
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => f.replace('.yaml', ''));
    return `Workflow '${workflowName}' not found. Available: ${available.join(', ')}`;
  }

  // Load YAML config — use dynamic require to get the shared loader
  let workflowConfig;
  try {
    const { loadWorkflowConfig } = require(path.join(PROJECT_ROOT, 'packages/shared/dist'));
    workflowConfig = loadWorkflowConfig(workflowPath);
  } catch (err) {
    return `Failed to load workflow config: ${err.message}`;
  }

  const slug = args.task
    .slice(0, 30)
    .replace(/[^a-zA-Z0-9]/g, '-')
    .toLowerCase();
  const workflowId = `tap-${Date.now()}-${slug}`;

  const handle = await client.workflow.start('pieceWorkflow', {
    taskQueue: 'orchestrator',
    workflowId,
    args: [workflowConfig, args.task, { workflowSessionId: workflowId }],
  });

  return `Workflow started: ${handle.workflowId}\nTAP UI: http://localhost:8234`;
}

async function handleWorkflowStatus(args) {
  const client = await getTemporalClient();

  if (args.workflowId) {
    const handle = client.workflow.getHandle(args.workflowId);
    const desc = await handle.describe();
    const lines = [
      `Workflow: ${args.workflowId}`,
      `Type: ${desc.type}`,
      `Status: ${desc.status?.name}`,
      `Started: ${desc.startTime?.toISOString()}`,
    ];
    if (desc.closeTime) lines.push(`Completed: ${desc.closeTime.toISOString()}`);

    if (desc.status?.name === 'RUNNING') {
      try {
        const state = await handle.query('status');
        lines.push('', 'Current State:');
        lines.push(`  Step: ${state.currentStep}`);
        lines.push(`  Iteration: ${state.iteration}`);
        lines.push(`  Status: ${state.status}`);
      } catch {
        /* query not supported */
      }
    }

    try {
      const outputs = await handle.query('stepOutputs');
      if (outputs && Object.keys(outputs).length > 0) {
        lines.push('', 'Step Outputs:');
        for (const [step, output] of Object.entries(outputs)) {
          const preview = String(output).slice(0, 200).replace(/\n/g, ' ');
          lines.push(`  ${step}: ${preview}...`);
        }
      }
    } catch {
      /* not available */
    }

    return lines.join('\n');
  }

  // List recent workflows
  const workflows = client.workflow.list();
  const lines = ['Recent Workflows:', ''];
  let count = 0;
  for await (const wf of workflows) {
    if (count >= 20) break;
    count++;
    lines.push(`  ${(wf.status?.name || 'UNKNOWN').padEnd(12)} ${wf.workflowId} (${wf.type})`);
  }
  if (count === 0) lines.push('  No workflows found.');
  return lines.join('\n');
}

async function handleSignalWorkflow(args) {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(args.workflowId);
  await handle.signal('userInput', args.message);
  return `Signal sent to ${args.workflowId}: "${args.message}"`;
}

async function handleCancelWorkflow(args) {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(args.workflowId);
  await handle.cancel();
  return `Cancelled workflow: ${args.workflowId}`;
}

async function main() {
  const server = new Server({ name: 'tap-dev', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      let result;
      switch (name) {
        case 'tap_service_status':
          result = await handleServiceStatus();
          break;
        case 'tap_service_restart':
          result = await handleServiceRestart(args || {});
          break;
        case 'tap_run_workflow':
          result = await handleRunWorkflow(args);
          break;
        case 'tap_workflow_status':
          result = await handleWorkflowStatus(args || {});
          break;
        case 'tap_signal_workflow':
          result = await handleSignalWorkflow(args);
          break;
        case 'tap_cancel_workflow':
          result = await handleCancelWorkflow(args);
          break;
        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      }
      return { content: [{ type: 'text', text: result }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('[TAP MCP] Fatal:', err);
  process.exit(1);
});
