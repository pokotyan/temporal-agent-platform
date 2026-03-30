import path from 'node:path';
import { TASK_QUEUES } from '@tap/shared';
import { NativeConnection, Worker } from '@temporalio/worker';

/**
 * Orchestrator Worker — runs Workflow code only.
 *
 * This worker is lightweight because it only executes the deterministic
 * workflow logic (pieceWorkflow, stepWorkflow, ambientAgentWorkflow).
 * No activities run here, keeping resource usage minimal.
 *
 * Single replica is sufficient for most workloads.
 */
async function run() {
  const connection = await NativeConnection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  });

  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    taskQueue: TASK_QUEUES.ORCHESTRATOR,
    workflowsPath: path.resolve(__dirname, '../../workflows/dist'),
  });

  console.log(`[orchestrator-worker] Starting on task queue: ${TASK_QUEUES.ORCHESTRATOR}`);
  console.log(`[orchestrator-worker] Temporal address: ${process.env.TEMPORAL_ADDRESS || 'localhost:7233'}`);

  await worker.run();
}

run().catch((err) => {
  console.error('[orchestrator-worker] Fatal error:', err);
  process.exit(1);
});
