import type { AmbientConfig } from '@tap/shared';
import { condition, proxyActivities, setHandler, sleep } from '@temporalio/workflow';
import { pauseSignal, resumeSignal, statusQuery } from './signals';

/** Ambient agent state (queryable) */
interface AmbientState {
  status: 'running' | 'paused' | 'completed' | 'stopped';
  lastResult: string;
  runCount: number;
  paused: boolean;
}

interface AmbientActivities {
  executePrompt(params: {
    prompt: string;
    context: { lastResult: string; runCount: number };
    agentConfig?: string;
    model?: string;
  }): Promise<string>;

  evaluateCondition(condition: string, state: { lastResult: string; runCount: number }): Promise<boolean>;
}

/**
 * Ambient Agent Workflow — Durable Loop.
 *
 * Enhanced /loop with Temporal durability:
 * - Survives process crashes (Temporal replay)
 * - Pause/resume via signals
 * - Conditional stop via AI judgment
 * - Full execution history in Temporal Web UI
 * - Inter-loop coordination via signals/queries
 *
 * Usage:
 *   tap loop "check deploy status" --every 5m --stop-when "deploy complete"
 */
export async function ambientAgentWorkflow(config: AmbientConfig): Promise<AmbientState> {
  const acts = proxyActivities<AmbientActivities>({
    startToCloseTimeout: '10 minutes',
    taskQueue: 'agent-tasks',
    retry: { maximumAttempts: 3 },
  });

  const state: AmbientState = {
    status: 'running',
    lastResult: '',
    runCount: 0,
    paused: false,
  };

  // ── Signal Handlers ──
  setHandler(pauseSignal, () => {
    state.paused = true;
    state.status = 'paused';
  });

  setHandler(resumeSignal, () => {
    state.paused = false;
    state.status = 'running';
  });

  // Query returns the full ambient state
  setHandler(statusQuery, () => state as any);

  // Parse interval string to milliseconds
  const intervalMs = parseInterval(config.interval);
  const maxIter = config.maxIterations || 0; // 0 = unlimited

  // ── Main Loop ──
  while (true) {
    // Respect pause
    if (state.paused) {
      await condition(() => !state.paused);
    }

    state.runCount++;

    // Execute the prompt
    try {
      state.lastResult = await acts.executePrompt({
        prompt: config.prompt,
        context: {
          lastResult: state.lastResult,
          runCount: state.runCount,
        },
        agentConfig: config.agentConfig,
        model: config.model,
      });
    } catch (err) {
      // Log error but continue loop (resilient)
      state.lastResult = `Error on run #${state.runCount}: ${err}`;
    }

    // Check stop condition (AI judges whether goal is met)
    if (config.stopCondition) {
      try {
        const shouldStop = await acts.evaluateCondition(config.stopCondition, {
          lastResult: state.lastResult,
          runCount: state.runCount,
        });
        if (shouldStop) {
          state.status = 'completed';
          break;
        }
      } catch {
        // Condition evaluation failure — continue loop
      }
    }

    // Check max iterations
    if (maxIter > 0 && state.runCount >= maxIter) {
      state.status = 'stopped';
      break;
    }

    // Sleep until next iteration
    // This is a Temporal timer — survives crashes and process restarts
    await sleep(intervalMs);
  }

  return state;
}

/**
 * Parse interval string to milliseconds.
 * Supports: 30s, 5m, 1h, 1d
 */
function parseInterval(interval: string): number {
  const match = interval.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    throw new Error(`Invalid interval format: ${interval}. Use: 30s, 5m, 1h, 1d`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown interval unit: ${unit}`);
  }
}
