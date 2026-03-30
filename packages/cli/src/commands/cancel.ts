import { Client, Connection } from '@temporalio/client';
import chalk from 'chalk';

interface CancelOptions {
  temporalAddress: string;
}

export async function cancelCommand(id: string, options: CancelOptions) {
  const connection = await Connection.connect({ address: options.temporalAddress });
  const client = new Client({ connection });

  const handle = client.workflow.getHandle(id);

  try {
    await handle.cancel();
    console.log(chalk.yellow(`Workflow cancelled: ${id}`));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}
