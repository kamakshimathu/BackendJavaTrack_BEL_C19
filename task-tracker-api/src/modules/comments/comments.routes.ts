import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate, type AuthLocals } from '../../middleware/authenticate.js';
import { emptyQuerySchema, paginationSchema } from '../../shared/request-schemas.js';
import { taskParamsSchema } from '../tasks/tasks.schemas.js';
import * as comments from './comments.service.js';

const bodySchema = z.strictObject({ content: z.string().trim().min(1).max(5000) });
const paramsSchema = z.strictObject({ commentId: z.uuid() });
export const taskCommentsRouter = Router({ mergeParams: true });
taskCommentsRouter.post('/', async (req, res: Response<unknown, AuthLocals>) => {
  const { taskId } = taskParamsSchema.parse(req.params);
  emptyQuerySchema.parse(req.query);
  res.status(201).json({ comment: await comments.createComment(res.locals.user.id, taskId, bodySchema.parse(req.body).content) });
});
taskCommentsRouter.get('/', async (req, res: Response<unknown, AuthLocals>) => {
  const { taskId } = taskParamsSchema.parse(req.params);
  res.json(await comments.listComments(res.locals.user.id, taskId, paginationSchema.parse(req.query)));
});

export const commentsRouter = Router();
commentsRouter.use(authenticate);
commentsRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
commentsRouter.patch('/:commentId', async (req, res: Response<unknown, AuthLocals>) => {
  const { commentId } = paramsSchema.parse(req.params);
  emptyQuerySchema.parse(req.query);
  res.json({ comment: await comments.updateComment(res.locals.user.id, commentId, bodySchema.parse(req.body).content) });
});
commentsRouter.delete('/:commentId', async (req, res: Response<unknown, AuthLocals>) => {
  const { commentId } = paramsSchema.parse(req.params);
  emptyQuerySchema.parse(req.query);
  emptyQuerySchema.parse(req.body ?? {});
  await comments.deleteComment(res.locals.user.id, commentId);
  res.status(204).end();
});
