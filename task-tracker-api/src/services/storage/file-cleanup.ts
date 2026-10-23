import { database } from '../../config/database.js';
import { storage } from './local-storage.js';

// Each batch is bounded; failures remain durable and retryable, without raw logs.
export async function cleanupFiles(limit = 50, onlyKeys?: string[]) {
  const jobs = await database.fileCleanup.findMany({ where: {
    notBefore: { lte: new Date() }, ...(onlyKeys ? { storageKey: { in: onlyKeys } } : {}),
  }, orderBy: [{ notBefore: 'asc' }, { storageKey: 'asc' }], take: Math.min(limit, 100) });
  let cleaned = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const done = await database.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ storageKey: string }>>`
          SELECT "storageKey" FROM "FileCleanup"
          WHERE "storageKey" = ${job.storageKey} AND "notBefore" <= NOW()
          FOR UPDATE SKIP LOCKED`;
        if (!locked.length) return false;
        // Defensive: never delete content referenced by live metadata.
        if (await tx.taskAttachment.findUnique({ where: { storageKey: job.storageKey }, select: { id: true } })) {
          await tx.fileCleanup.delete({ where: { storageKey: job.storageKey } });
          return false;
        }
        await storage.delete(job.storageKey);
        await tx.fileCleanup.delete({ where: { storageKey: job.storageKey } });
        return true;
      });
      if (done) cleaned++;
    } catch { failed++; }
  }
  return { cleaned, failed };
}

export async function tryCleanupFiles(keys?: string[]): Promise<void> {
  try {
    const result = await cleanupFiles(50, keys);
    if (result.failed) console.error('Some private file cleanup jobs remain pending.');
  } catch { console.error('Private file cleanup is pending; retry the cleanup command.'); }
}
