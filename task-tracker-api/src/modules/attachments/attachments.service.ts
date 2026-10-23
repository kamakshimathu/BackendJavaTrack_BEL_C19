import { randomUUID } from 'node:crypto';
import { database } from '../../config/database.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../shared/app-error.js';
import { paginationArgs, type Pagination } from '../../shared/request-schemas.js';
import { storage } from '../../services/storage/local-storage.js';
import { tryCleanupFiles } from '../../services/storage/file-cleanup.js';
import { getTask, taskVisibility, withTaskWrite } from '../tasks/tasks.service.js';
import { managers } from '../teams/team-authorization.js';
import { validateFile } from './file-validation.js';

const attachmentSelect = {
  id: true, taskId: true, uploadedById: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true,
  uploadedBy: { select: { id: true, name: true } },
} satisfies Prisma.TaskAttachmentSelect;
type PublicAttachment = Prisma.TaskAttachmentGetPayload<{ select: typeof attachmentSelect }>;
const publicAttachment = (attachment: PublicAttachment) => ({ ...attachment, downloadUrl: `/api/attachments/${attachment.id}/download` });
const notFound = () => new AppError(404, 'Attachment not found');

export async function uploadAttachment(actorId: string, taskId: string, file: {
  originalname: string; mimetype: string; buffer: Buffer;
}) {
  await getTask(actorId, taskId);
  const metadata = validateFile(file);
  const storageKey = randomUUID();
  // Commit a recovery record BEFORE disk I/O. An interrupted upload is cleaned
  // after this one-hour lease; finalization and cleanup lock the same record.
  await database.fileCleanup.create({ data: { storageKey, notBefore: new Date(Date.now() + 3600000) } });
  try {
    await storage.save(storageKey, file.buffer);
    return await withTaskWrite(actorId, taskId, async (tx) => {
      const lease = await tx.$queryRaw<Array<{ notBefore: Date }>>`
        SELECT "notBefore" FROM "FileCleanup" WHERE "storageKey" = ${storageKey} FOR UPDATE`;
      if (!lease[0] || lease[0].notBefore <= new Date()) throw new AppError(500, 'Upload could not be finalized');
      const attachment = await tx.taskAttachment.create({
        data: { ...metadata, taskId, uploadedById: actorId, storageKey }, select: attachmentSelect,
      });
      await tx.fileCleanup.delete({ where: { storageKey } });
      return publicAttachment(attachment);
    });
  } catch (error) {
    try {
      await database.fileCleanup.upsert({ where: { storageKey },
        create: { storageKey, notBefore: new Date() }, update: { notBefore: new Date() } });
    } catch { /* The original lease provides recovery after a database outage. */ }
    await tryCleanupFiles([storageKey]);
    if (error instanceof AppError) throw error;
    throw new AppError(500, 'Attachment upload failed');
  }
}

export async function listAttachments(actorId: string, taskId: string, pagination: Pagination) {
  await getTask(actorId, taskId);
  const where = { taskId, task: taskVisibility(actorId) };
  const [attachments, total] = await database.$transaction([
    database.taskAttachment.findMany({ where, select: attachmentSelect,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], ...paginationArgs(pagination) }),
    database.taskAttachment.count({ where }),
  ]);
  return { attachments: attachments.map(publicAttachment), pagination: { ...pagination, total } };
}

async function reference(actorId: string, attachmentId: string) {
  const attachment = await database.taskAttachment.findFirst({
    where: { id: attachmentId, task: taskVisibility(actorId) }, select: { taskId: true },
  });
  if (!attachment) throw notFound();
  return attachment;
}

export async function downloadAttachment(actorId: string, attachmentId: string) {
  const attachment = await reference(actorId, attachmentId);
  let opened: Awaited<ReturnType<typeof storage.open>> | undefined;
  try {
    return await withTaskWrite(actorId, attachment.taskId, async (tx) => {
      const current = await tx.taskAttachment.findUnique({ where: { id: attachmentId } });
      if (!current) throw notFound();
      // Authorization finishes before any filesystem open.
      const file = await storage.open(current.storageKey);
      opened = file;
      if (file.size !== current.sizeBytes) { file.stream.destroy(); throw new AppError(500, 'Stored file is unavailable'); }
      return { ...file, originalName: current.originalName, mimeType: current.mimeType };
    });
  } catch (error) {
    opened?.stream.destroy();
    if (error instanceof AppError && error.status === 404) throw notFound();
    throw error;
  }
}

export async function deleteAttachment(actorId: string, attachmentId: string): Promise<void> {
  const attachment = await reference(actorId, attachmentId);
  let key: string;
  try {
    key = await withTaskWrite(actorId, attachment.taskId, async (tx, _task, member) => {
      const current = await tx.taskAttachment.findUnique({ where: { id: attachmentId } });
      if (!current) throw notFound();
      if (current.uploadedById !== actorId && !managers.includes(member.role)) throw new AppError(403, 'Cannot delete this attachment');
      // The SQL trigger inserts the durable cleanup job in this transaction.
      await tx.taskAttachment.delete({ where: { id: attachmentId } });
      return current.storageKey;
    });
  } catch (error) {
    if (error instanceof AppError && error.status === 404) throw notFound();
    throw error;
  }
  await tryCleanupFiles([key]);
}
