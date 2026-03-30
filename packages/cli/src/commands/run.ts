import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadWorkflowConfig } from '@tap/shared/dist/yaml/loader';
import { Client, Connection } from '@temporalio/client';
import chalk from 'chalk';

const RESOURCES_DIR = resolve(__dirname, '../../../../resources');

interface RunOptions {
  workflow: string;
  issue?: string;
  file?: string;
  pipeline?: boolean;
  autoPr?: boolean;
  sandbox?: boolean;
  temporalAddress: string;
  namespace: string;
}

export async function runCommand(task: string | undefined, options: RunOptions) {
  // Resolve task from various sources
  let resolvedTask = task;

  if (options.file) {
    resolvedTask = readFileSync(resolve(options.file), 'utf-8').trim();
  } else if (options.issue) {
    // TODO: Fetch from GitHub API
    resolvedTask = `GitHub Issue #${options.issue}`;
  }

  if (!resolvedTask) {
    console.error(chalk.red('Error: No task provided. Use: tap run "your task"'));
    process.exit(1);
  }

  // Load workflow config
  const workflowPath = resolve(RESOURCES_DIR, `workflows/${options.workflow}.yaml`);
  let workflowConfig: ReturnType<typeof loadWorkflowConfig>;
  try {
    workflowConfig = loadWorkflowConfig(workflowPath);
  } catch (err: any) {
    console.error(chalk.red(`Error loading workflow '${options.workflow}': ${err.message}`));
    process.exit(1);
  }

  // Connect to Temporal
  console.log(chalk.gray(`Connecting to Temporal at ${options.temporalAddress}...`));
  const connection = await Connection.connect({
    address: options.temporalAddress,
  });
  const client = new Client({ connection, namespace: options.namespace });

  // Generate workflow ID
  const slug = resolvedTask
    .slice(0, 30)
    .replace(/[^a-zA-Z0-9]/g, '-')
    .toLowerCase();
  const workflowId = `tap-${Date.now()}-${slug}`;

  // Start the workflow
  console.log(chalk.blue(`Starting workflow: ${workflowConfig.name}`));
  console.log(chalk.gray(`Task: ${resolvedTask.slice(0, 100)}${resolvedTask.length > 100 ? '...' : ''}`));

  const handle = await client.workflow.start('pieceWorkflow', {
    taskQueue: 'orchestrator',
    workflowId,
    args: [workflowConfig, resolvedTask, { workflowSessionId: workflowId }],
  });

  console.log(chalk.green(`\nWorkflow started: ${handle.workflowId}`));
  console.log(
    chalk.gray(`Temporal UI: http://localhost:8233/namespaces/${options.namespace}/workflows/${handle.workflowId}`),
  );

  if (options.pipeline) {
    // Pipeline mode: wait for result silently
    console.log(chalk.gray('Pipeline mode: waiting for completion...'));
    const result = await handle.result();
    const exitCode = result.state.status === 'completed' ? 0 : 1;
    console.log(
      exitCode === 0
        ? chalk.green(`\nWorkflow completed successfully`)
        : chalk.red(`\nWorkflow ${result.state.status}`),
    );
    process.exit(exitCode);
  } else {
    // Interactive mode: stream status updates
    console.log(chalk.gray('\nStreaming status (Ctrl+C to detach)...\n'));
    await streamStatus(handle, client);
  }
}

async function streamStatus(handle: any, _client: Client) {
  let lastStep = '';
  let lastIteration = 0;

  const poll = setInterval(async () => {
    try {
      const state = await handle.query('status');

      if (state.currentStep !== lastStep || state.iteration !== lastIteration) {
        lastStep = state.currentStep;
        lastIteration = state.iteration;

        const statusIcon =
          state.status === 'running'
            ? '>'
            : state.status === 'completed'
              ? chalk.green('v')
              : state.status === 'blocked'
                ? chalk.yellow('?')
                : chalk.red('x');

        console.log(`${statusIcon} [${state.iteration}] Step: ${chalk.bold(state.currentStep)} (${state.status})`);
      }

      if (state.status !== 'running' && state.status !== 'blocked') {
        clearInterval(poll);
        console.log(
          state.status === 'completed' ? chalk.green('\nWorkflow completed!') : chalk.red(`\nWorkflow ${state.status}`),
        );
        process.exit(state.status === 'completed' ? 0 : 1);
      }
    } catch {
      // Query might fail if workflow just started
    }
  }, 2000);

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    clearInterval(poll);
    console.log(chalk.gray('\nDetached. Workflow continues in background.'));
    console.log(chalk.gray(`Resume with: tap status ${handle.workflowId}`));
    process.exit(0);
  });
}
