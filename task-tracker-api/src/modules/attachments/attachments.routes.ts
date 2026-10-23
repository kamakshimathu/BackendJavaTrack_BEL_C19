import { Router, type Response, type RequestHandler } from 'express';
import { pipeline } from 'node:stream/promises';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, type AuthLocals } from '../../middleware/authenticate.js';
import { AppError } from '../../shared/app-error.js';
import { emptyQuerySchema, paginationSchema } from '../../shared/request-schemas.js';
import { taskParamsSchema } from '../tasks/tasks.schemas.js';
import { getTask } from '../tasks/tasks.service.js';
import { MAX_FILE_BYTES } from './file-validation.js';
import * as attachments from './attachments.service.js';

const upload = multer({ storage: multer.memoryStorage(), preservePath: true, limits: {
  fileSize: MAX_FILE_BYTES, files: 1, fields: 0, parts: 2, fieldNameSize: 32, fieldSize: 0, headerPairs: 50,
} }).single('file');
const parseUpload: RequestHandler = (req, res, next) => {
  upload(req, res, (error: unknown) => {
    if (error) {
      next(new AppError(error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'Invalid multipart upload'));
    } else next();
  });
};
const uploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: { message: 'Too many uploads; try again later' } } });
let activeUploads = 0;
const uploadCapacity: RequestHandler = (_req, res, next) => {
  if (activeUploads >= 4) { next(new AppError(429, 'Upload capacity reached; try again later')); return; }
  activeUploads++;
  let released = false;
  const release = () => { if (!released) { released = true; activeUploads--; } };
  res.once('finish', release);
  res.once('close', release);
  next();
};

export const taskAttachmentsRouter = Router({ mergeParams: true });
taskAttachmentsRouter.post('/', uploadLimiter, uploadCapacity, async (req, res: Response<unknown, AuthLocals>, next) => {
  const { taskId } = taskParamsSchema.parse(req.params);
  emptyQuerySchema.parse(req.query);
  await getTask(res.locals.user.id, taskId);
  if (!req.is('multipart/form-data')) throw new AppError(415, 'Use multipart/form-data with field file');
  next();
}, parseUpload, async (req, res: Response<unknown, AuthLocals>) => {
  const { taskId } = taskParamsSchema.parse(req.params);
  if (!req.file) throw new AppError(400, 'Exactly one file is required');
  res.status(201).json({ attachment: await attachments.uploadAttachment(res.locals.user.id, taskId, req.file) });
});
taskAttachmentsRouter.get('/', async (req, res: Response<unknown, AuthLocals>) => {
  const { taskId } = taskParamsSchema.parse(req.params);
  res.json(await attachments.listAttachments(res.locals.user.id, taskId, paginationSchema.parse(req.query)));
});

const paramsSchema = z.strictObject({ attachmentId: z.uuid() });
export const attachmentsRouter = Router();
attachmentsRouter.use(authenticate);
attachmentsRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
attachmentsRouter.get('/:attachmentId/download', async (req, res: Response<unknown, AuthLocals>) => {
  const { attachmentId } = paramsSchema.parse(req.params);
  emptyQuerySchema.parse(req.query);
  const file = await attachments.downloadAttachment(res.locals.user.id, attachmentId);
  const filename = /^[A-Za-z0-9][A-Za-z0-9 _-]*\.[A-Za-z]+$/.test(file.originalName) ? file.originalName : 'attachment.bin';
  res.attachment(filename);
  res.type(['application/pdf', 'image/png', 'image/jpeg', 'text/plain'].includes(file.mimeType) ? file.mimeType : 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  res.setHeader('Content-Length', file.size);
  try { await pipeline(file.stream, res); }
  catch { if (res.headersSent) res.destroy(); else throw new AppError(500, 'Stored file is unavailable'); }
});
attachmentsRouter.delete('/:attachmentId', async (req, res: Response<unknown, AuthLocals>) => {
  const { attachmentId } = paramsSchema.parse(req.params);
  emptyQuerySchema.parse(req.query);
  emptyQuerySchema.parse(req.body ?? {});
  await attachments.deleteAttachment(res.locals.user.id, attachmentId);
  res.status(204).end();
});
