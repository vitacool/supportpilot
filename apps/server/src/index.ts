import { createApp } from './app.js';
import { config } from './config.js';
import { closeDb, initDb } from './db/index.js';
import { initVectorStore, closeVectorStore } from './vector/index.js';
import { stopIndexWorker } from './lib/indexer.js';

initDb();
const app = createApp();
void initVectorStore()
  .then((store) => console.log(`  ▸ vector store: ${store.kind}`))
  .catch((error) => console.error('[supportpilot] vector store unavailable', error));

const server = app.listen(config.port, () => {
  const mode = config.isProduction ? 'production' : 'development';
  console.log(`\n  ▸ SupportPilot API ready (${mode})`);
  console.log(`  ▸ http://localhost:${config.port}`);
  console.log(`  ▸ data: ${config.dbPath}`);
  console.log('  ▸ demo: admin@supportpilot.local / Support@2026\n');
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[supportpilot] ${signal} received, shutting down...`);
  server.close();
  try {
    await stopIndexWorker();
    await closeVectorStore();
  } catch (error) {
    console.error('[supportpilot] shutdown warning', error);
  }
  closeDb();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
