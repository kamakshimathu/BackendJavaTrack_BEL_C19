import { createServer } from 'node:http';
import { app } from './app.js';
import { database } from './config/database.js';
import { env } from './config/env.js';

const server = createServer(app);
let shuttingDown = false;

async function shutdown(exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;

  const timeout = setTimeout(() => {
    console.error('Shutdown timed out.');
    server.closeAllConnections();
    process.exit(1);
  }, 10_000);
  timeout.unref();

  try {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
    await database.$disconnect();
  } catch {
    console.error('Could not cleanly release server resources.');
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
}

process.on('SIGINT', () => { void shutdown(0); });
process.on('SIGTERM', () => { void shutdown(0); });
server.on('error', () => {
  console.error('HTTP server failed. Check the configured port.');
  void shutdown(1);
});

try {
  await database.$connect();
  await database.$queryRaw`SELECT 1`;
  if (!shuttingDown) {
    server.listen(env.PORT, () => {
      console.info(`API listening on port ${env.PORT}`);
    });
  }
} catch {
  console.error('Database startup failed. Check PostgreSQL and DATABASE_URL.');
  await shutdown(1);
}
