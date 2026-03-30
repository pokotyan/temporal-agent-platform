import * as activities from '@tap/activities';
import { TASK_QUEUES } from '@tap/shared';
import { NativeConnection, Worker } from '@temporalio/worker';

/**
 * Agent Worker — runs Activity code.
 *
 * This worker handles all agent-related activities:
 * - Agent execution (Claude API calls)
 * - Instruction building
 * - Rule evaluation (AI judge)
 * - Report generation
 * - (Phase 4) Sandbox pod management
 * - (Phase 4) Git operations
 *
 * Scaled via HPA based on task queue depth.
 * Multiple replicas can poll the same queue for horizontal scaling.
 */
async function run() {
  const connection = await NativeConnection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  });

  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    taskQueue: TASK_QUEUES.AGENT,
    activities,
    // Activity execution limits
    maxConcurrentActivityTaskExecutions: parseInt(process.env.MAX_CONCURRENT_ACTIVITIES || '5', 10),
  });

  console.log(`[agent-worker] Starting on task queue: ${TASK_QUEUES.AGENT}`);
  console.log(`[agent-worker] Temporal address: ${process.env.TEMPORAL_ADDRESS || 'localhost:7233'}`);
  console.log(`[agent-worker] Max concurrent activities: ${process.env.MAX_CONCURRENT_ACTIVITIES || '5'}`);

  await worker.run();
}

run().catch((err) => {
  console.error('[agent-worker] Fatal error:', err);
  process.exit(1);
});
