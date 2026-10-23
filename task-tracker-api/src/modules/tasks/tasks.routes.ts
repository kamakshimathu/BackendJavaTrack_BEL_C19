import { Router, type Response } from 'express';
import { authenticate, type AuthLocals } from '../../middleware/authenticate.js';
import { emptyQuerySchema, projectParamsSchema } from '../../shared/request-schemas.js';
import { assignedTaskQuerySchema, assignTaskSchema, createTaskSchema, projectTaskQuerySchema,
  taskParamsSchema, taskStatusSchema, updateTaskSchema } from './tasks.schemas.js';
import * as tasks from './tasks.service.js';
import { taskCommentsRouter } from '../comments/comments.routes.js';
import { taskAttachmentsRouter } from '../attachments/attachments.routes.js';

export const projectTasksRouter = Router({ mergeParams: true });
projectTasksRouter.post('/', async (req, res: Response<unknown, AuthLocals>) => {
  const { projectId } = projectParamsSchema.parse(req.params);
  emptyQuerySchema.parse(req.query);
  res.status(201).json({ task: await tasks.createTask(res.locals.user.id, projectId, createTaskSchema.parse(req.body)) });
});
projectTasksRouter.get('/', async (req, res: Response<unknown, AuthLocals>) => {
  const { projectId } = projectParamsSchema.parse(req.params);
  res.json(await tasks.listProjectTasks(res.locals.user.id, projectId, projectTaskQuerySchema.parse(req.query)));
});

export const tasksRouter = Router();
tasksRouter.use(authenticate);
tasksRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
// Keep this fixed route ahead of /:taskId so it is never parsed as a UUID.
tasksRouter.get('/assigned-to-me', async (req, res: Response<unknown, AuthLocals>) => {
  res.json(await tasks.assignedToMe(res.locals.user.id, assignedTaskQuerySchema.parse(req.query)));
});
tasksRouter.get('/:taskId', async (req, res: Response<unknown, AuthLocals>) => {
  const { taskId } = taskParamsSchema.parse(req.params);
  emptyQuerySchema.parse(req.query);
  res.json({ task: await tasks.getTask(res.locals.user.id, taskId) });
});
tasksRouter.patch('/:taskId', async (req, res: Response<unknown, AuthLocals>) => {
  const { taskId } = taskParamsSchema.parse(req.params);
  emptyQuerySchema.parse(req.query);
  res.json({ task: await tasks.updateTask(res.locals.user.id, taskId, updateTaskSchema.parse(req.body)) });
});
tasksRouter.patch('/:taskId/assignee', async (req, res: Response<unknown, AuthLocals>) => {
  const { taskId } = taskParamsSchema.parse(req.params);
  emptyQuerySchema.parse(req.query);
  res.json({ task: await tasks.assignTask(res.locals.user.id, taskId, assignTaskSchema.parse(req.body).assignedToId) });
});
tasksRouter.patch('/:taskId/status', async (req, res: Response<unknown, AuthLocals>) => {
  const { taskId } = taskParamsSchema.parse(req.params);
  emptyQuerySchema.parse(req.query);
  res.json({ task: await tasks.changeTaskStatus(res.locals.user.id, taskId, taskStatusSchema.parse(req.body).status) });
});
tasksRouter.delete('/:taskId', async (req, res: Response<unknown, AuthLocals>) => {
  const { taskId } = taskParamsSchema.parse(req.params);
  emptyQuerySchema.parse(req.query);
  emptyQuerySchema.parse(req.body ?? {});
  await tasks.deleteTask(res.locals.user.id, taskId);
  res.status(204).end();
});
tasksRouter.use('/:taskId/comments', taskCommentsRouter);
tasksRouter.use('/:taskId/attachments', taskAttachmentsRouter);
