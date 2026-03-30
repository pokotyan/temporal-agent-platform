import { Client, Connection } from '@temporalio/client';
import chalk from 'chalk';

interface StatusOptions {
  temporalAddress: string;
}

export async function statusCommand(id: string | undefined, options: StatusOptions) {
  const connection = await Connection.connect({ address: options.temporalAddress });
  const client = new Client({ connection });

  if (id) {
    // Show specific workflow
    await showWorkflowDetail(client, id);
  } else {
    // List all recent workflows
    await listWorkflows(client);
  }
}

async function showWorkflowDetail(client: Client, id: string) {
  const handle = client.workflow.getHandle(id);

  try {
    const desc = await handle.describe();
    console.log(chalk.bold(`Workflow: ${id}`));
    console.log(chalk.gray(`  Type: ${desc.type}`));
    console.log(chalk.gray(`  Status: ${desc.status?.name}`));
    console.log(chalk.gray(`  Started: ${desc.startTime?.toISOString()}`));
    if (desc.closeTime) {
      console.log(chalk.gray(`  Completed: ${desc.closeTime.toISOString()}`));
    }

    // Try to query current state
    if (desc.status?.name === 'RUNNING') {
      try {
        const state = (await handle.query('status')) as {
          currentStep: string;
          iteration: number;
          status: string;
          userInputs?: string[];
        };
        console.log('');
        console.log(chalk.blue('Current State:'));
        console.log(chalk.gray(`  Step: ${state.currentStep}`));
        console.log(chalk.gray(`  Iteration: ${state.iteration}`));
        console.log(chalk.gray(`  Status: ${state.status}`));

        if (state.userInputs && state.userInputs.length > 0) {
          console.log(chalk.gray(`  User inputs: ${state.userInputs.length}`));
        }
      } catch {
        // Query not supported for this workflow type
      }
    }

    // Try to get step outputs
    try {
      const outputs = (await handle.query('stepOutputs')) as Record<string, string>;
      if (Object.keys(outputs).length > 0) {
        console.log('');
        console.log(chalk.blue('Step Outputs:'));
        for (const [step, output] of Object.entries(outputs)) {
          const preview = output.slice(0, 100).replace(/\n/g, ' ');
          console.log(`  ${chalk.bold(step)}: ${chalk.gray(preview)}...`);
        }
      }
    } catch {
      // Step outputs query not available
    }
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

async function listWorkflows(client: Client) {
  console.log(chalk.blue('Recent Workflows:\n'));

  const workflows = client.workflow.list();

  let count = 0;
  for await (const wf of workflows) {
    if (count >= 20) break;
    count++;

    const statusColor =
      wf.status?.name === 'RUNNING'
        ? chalk.green
        : wf.status?.name === 'COMPLETED'
          ? chalk.blue
          : wf.status?.name === 'FAILED'
            ? chalk.red
            : chalk.gray;

    console.log(
      `  ${statusColor(wf.status?.name?.padEnd(12) || 'UNKNOWN')} ` +
        `${chalk.bold(wf.workflowId)} ` +
        chalk.gray(`(${wf.type})`),
    );
  }

  if (count === 0) {
    console.log(chalk.gray('  No workflows found.'));
  }
}
