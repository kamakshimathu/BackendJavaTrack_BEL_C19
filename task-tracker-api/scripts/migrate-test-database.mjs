import 'dotenv/config';
import { spawnSync } from 'node:child_process';

// No database creation or resets. Only apply normal migrations to a named test DB.
if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL privately before migrating the test database.');
let target;
let development;
try {
  target = new URL(process.env.TEST_DATABASE_URL);
  development = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
} catch {
  throw new Error('Invalid database URL configuration. Values suppressed.');
}
const targetName = decodeURIComponent(target.pathname.slice(1));
const developmentName = development ? decodeURIComponent(development.pathname.slice(1)) : '';
if (!['postgres:', 'postgresql:'].includes(target.protocol)
  || !/^[a-zA-Z0-9_]+_test$/.test(targetName) || targetName === developmentName) {
  throw new Error('Refusing migration: use a separate database with a different name ending in _test.');
}
const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
  env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL }, encoding: 'utf8',
});
if (result.status !== 0) {
  console.error('Test database migration failed. Check the dedicated database, privileges, and migration state. Connection details suppressed.');
  process.exit(1);
}
console.log('Test database migrations applied successfully.');
