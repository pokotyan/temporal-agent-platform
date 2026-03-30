import { Client, Connection } from '@temporalio/client';
import chalk from 'chalk';

interface LoopStartOptions {
  every: string;
  stopWhen?: string;
  max: string;
  model?: string;
  temporalAddress: string;
}

interface LoopActionOptions {
  temporalAddress: string;
}

export const loopCommand = {
  /**
   * Create a new Durable Loop (Ambient Agent).
   *
   * Example:
   *   tap loop start "check deploy status" --every 5m --stop-when "deploy complete"
   */
  async start(prompt: string, options: LoopStartOptions) {
    const connection = await Connection.connect({ address: options.temporalAddress });
    const client = new Client({ connection });

    const workflowId = `tap-loop-${Date.now()}`;

    console.log(chalk.blue('Creating Durable Loop...'));
    console.log(chalk.gray(`  Prompt: ${prompt}`));
    console.log(chalk.gray(`  Interval: ${options.every}`));
    if (options.stopWhen) {
      console.log(chalk.gray(`  Stop when: ${options.stopWhen}`));
    }

    const handle = await client.workflow.start('ambientAgentWorkflow', {
      taskQueue: 'orchestrator',
      workflowId,
      args: [
        {
          prompt,
          interval: options.every,
          stopCondition: options.stopWhen,
          maxIterations: parseInt(options.max, 10),
          model: options.model,
        },
      ],
    });

    console.log(chalk.green(`\nDurable Loop started: ${handle.workflowId}`));
    console.log(chalk.gray(`Temporal UI: http://localhost:8233/namespaces/default/workflows/${handle.workflowId}`));
    console.log('');
    console.log(chalk.gray('Commands:'));
    console.log(chalk.gray(`  tap loop pause ${handle.workflowId}`));
    console.log(chalk.gray(`  tap loop resume ${handle.workflowId}`));
    console.log(chalk.gray(`  tap loop stop ${handle.workflowId}`));
  },

  /**
   * List all running Durable Loops.
   */
  async list(options: LoopActionOptions) {
    const connection = await Connection.connect({ address: options.temporalAddress });
    const client = new Client({ connection });

    console.log(chalk.blue('Running Durable Loops:\n'));

    const workflows = client.workflow.list({
      query: 'WorkflowType = "ambientAgentWorkflow" AND ExecutionStatus = "Running"',
    });

    let count = 0;
    for await (const wf of workflows) {
      count++;
      console.log(`  ${chalk.bold(wf.workflowId)}`);
      console.log(chalk.gray(`    Started: ${wf.startTime?.toISOString()}`));
      console.log(chalk.gray(`    Status: ${wf.status?.name}`));
      console.log('');
    }

    if (count === 0) {
      console.log(chalk.gray('  No running loops.'));
    }
  },

  /**
   * Pause a running loop.
   */
  async pause(id: string, options: LoopActionOptions) {
    const connection = await Connection.connect({ address: options.temporalAddress });
    const client = new Client({ connection });

    const handle = client.workflow.getHandle(id);
    await handle.signal('pause');

    console.log(chalk.yellow(`Loop paused: ${id}`));
    console.log(chalk.gray(`Resume with: tap loop resume ${id}`));
  },

  /**
   * Resume a paused loop.
   */
  async resume(id: string, options: LoopActionOptions) {
    const connection = await Connection.connect({ address: options.temporalAddress });
    const client = new Client({ connection });

    const handle = client.workflow.getHandle(id);
    await handle.signal('resume');

    console.log(chalk.green(`Loop resumed: ${id}`));
  },

  /**
   * Stop and cancel a loop.
   */
  async stop(id: string, options: LoopActionOptions) {
    const connection = await Connection.connect({ address: options.temporalAddress });
    const client = new Client({ connection });

    const handle = client.workflow.getHandle(id);
    await handle.cancel();

    console.log(chalk.red(`Loop stopped: ${id}`));
  },
};
