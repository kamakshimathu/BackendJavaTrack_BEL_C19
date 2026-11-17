import { database } from '../../config/database.js';
import { cleanupFiles } from './file-cleanup.js';

try {
  const result = await cleanupFiles(100);
  console.info(JSON.stringify(result));
  if (result.failed) process.exitCode = 1;
} catch {
  console.error('File cleanup failed. Check database/storage access. Details suppressed.');
  process.exitCode = 1;
} finally { await database.$disconnect(); }
