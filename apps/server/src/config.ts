import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, '../../..');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const isProduction =
  process.env.NODE_ENV === 'production' ||
  process.argv.includes('--production');
const dataDir = path.resolve(ROOT_DIR, process.env.ASTRA_DATA_DIR || 'data');

export const config = {
  rootDir: ROOT_DIR,
  dataDir,
  dbPath: path.join(dataDir, 'supportpilot.db'),
  webDist: path.join(ROOT_DIR, 'apps/web/dist'),
  port: Number(process.env.PORT || 8788),
  isProduction,
  jwtSecret:
    process.env.JWT_SECRET ||
    'supportpilot-local-development-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  appSecret:
    process.env.APP_SECRET ||
    'supportpilot-local-encryption-secret-change-me',
  vectorDatabaseUrl: process.env.VECTOR_DATABASE_URL || '',
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  version: '1.0.0',
};

if (isProduction && !process.env.JWT_SECRET) {
  console.warn(
    '[supportpilot] WARNING: JWT_SECRET is not set. Configure it before exposing the service.',
  );
}
