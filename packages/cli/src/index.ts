#!/usr/bin/env node
import { Command } from 'commander';
import { cancelCommand } from './commands/cancel';

import { loopCommand } from './commands/loop';
import { runCommand } from './commands/run';
import { signalCommand } from './commands/signal';
import { statusCommand } from './commands/status';

const program = new Command();

program.name('tap').description('Temporal Agent Platform — AI workflow orchestration').version('0.1.0');

// ── tap run ──
program
  .command('run')
  .description('Start a workflow for the given task')
  .argument('[task]', 'Task description')
  .option('-w, --workflow <name>', 'Workflow to use', 'default')
  .option('--issue <number>', 'Fetch GitHub issue as task')
  .option('--file <path>', 'Read task from file')
  .option('--pipeline', 'Non-interactive mode (for CI/CD)')
  .option('--auto-pr', 'Auto-create PR on completion')
  .option('--temporal-address <addr>', 'Temporal server address', 'localhost:7233')
  .option('--namespace <ns>', 'Temporal namespace', 'default')
  .action(runCommand);

// ── tap loop ──
const loop = program.command('loop').description('Durable Loop — enhanced /loop with Temporal durability');

loop
  .command('start')
  .description('Create a new Durable Loop')
  .argument('<prompt>', 'Prompt to execute each iteration')
  .option('--every <interval>', 'Interval between executions (e.g., 5m, 1h)', '10m')
  .option('--stop-when <condition>', 'Stop condition (evaluated by AI)')
  .option('--max <n>', 'Maximum iterations (0 = unlimited)', '0')
  .option('--model <model>', 'Model override')
  .option('--temporal-address <addr>', 'Temporal server address', 'localhost:7233')
  .action(loopCommand.start);

loop
  .command('list')
  .description('List running Durable Loops')
  .option('--temporal-address <addr>', 'Temporal server address', 'localhost:7233')
  .action(loopCommand.list);

loop
  .command('pause <id>')
  .description('Pause a running loop')
  .option('--temporal-address <addr>', 'Temporal server address', 'localhost:7233')
  .action(loopCommand.pause);

loop
  .command('resume <id>')
  .description('Resume a paused loop')
  .option('--temporal-address <addr>', 'Temporal server address', 'localhost:7233')
  .action(loopCommand.resume);

loop
  .command('stop <id>')
  .description('Stop and cancel a loop')
  .option('--temporal-address <addr>', 'Temporal server address', 'localhost:7233')
  .action(loopCommand.stop);

// ── tap status ──
program
  .command('status')
  .description('Show workflow execution status')
  .argument('[id]', 'Workflow ID (shows all if omitted)')
  .option('--temporal-address <addr>', 'Temporal server address', 'localhost:7233')
  .action(statusCommand);

// ── tap signal ──
program
  .command('signal')
  .description('Send user input to a blocked workflow')
  .argument('<id>', 'Workflow ID')
  .argument('<message>', 'Message to send')
  .option('--temporal-address <addr>', 'Temporal server address', 'localhost:7233')
  .action(signalCommand);

// ── tap cancel ──
program
  .command('cancel')
  .description('Cancel a running workflow')
  .argument('<id>', 'Workflow ID')
  .option('--temporal-address <addr>', 'Temporal server address', 'localhost:7233')
  .action(cancelCommand);

program.parse();
