import { Client, Connection } from '@temporalio/client';
import chalk from 'chalk';

interface SignalOptions {
  temporalAddress: string;
}

export async function signalCommand(id: string, message: string, options: SignalOptions) {
  const connection = await Connection.connect({ address: options.temporalAddress });
  const client = new Client({ connection });

  const handle = client.workflow.getHandle(id);

  try {
    await handle.signal('userInput', message);
    console.log(chalk.green(`Signal sent to ${id}: "${message}"`));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}
