import { existsSync, rmSync } from 'node:fs';
import { config } from '../config.js';
import { closeDb, initDb } from '../db/index.js';

closeDb();
for (const suffix of ['', '-wal', '-shm']) {
  const file = `${config.dbPath}${suffix}`;
  if (existsSync(file)) rmSync(file);
}
initDb();
closeDb();
console.log(`[supportpilot] Database reset: ${config.dbPath}`);
