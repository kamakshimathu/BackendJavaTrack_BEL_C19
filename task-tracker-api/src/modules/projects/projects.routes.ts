import { Router, type Response } from 'express';
import { authenticate, type AuthLocals } from '../../middleware/authenticate.js';
import { createDetailsSchema, updateDetailsSchema, emptyQuerySchema, paginationSchema,
  projectParamsSchema, teamParamsSchema } from '../../shared/request-schemas.js';
import * as projects from './projects.service.js';

export const teamProjectsRouter = Router({ mergeParams: true });
teamProjectsRouter.post('/', async (req, res: Response<unknown, AuthLocals>) => {
  const { teamId } = teamParamsSchema.parse(req.params);
  emptyQuerySchema.parse(req.query);
  res.status(201).json({ project: await projects.createProject(res.locals.user.id, teamId, createDetailsSchema.parse(req.body)) });
});
teamProjectsRouter.get('/', async (req, res: Response<unknown, AuthLocals>) => {
  const { teamId } = teamParamsSchema.parse(req.params);
  res.json(await projects.listProjects(res.locals.user.id, teamId, paginationSchema.parse(req.query)));
});

export const projectsRouter = Router();
projectsRouter.use(authenticate);
projectsRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
projectsRouter.get('/:projectId', async (req, res: Response<unknown, AuthLocals>) => {
  const { projectId } = projectParamsSchema.parse(req.params);
  emptyQuerySchema.parse(req.query);
  res.json({ project: await projects.getProject(res.locals.user.id, projectId) });
});
projectsRouter.patch('/:projectId', async (req, res: Response<unknown, AuthLocals>) => {
  const { projectId } = projectParamsSchema.parse(req.params);
  emptyQuerySchema.parse(req.query);
  res.json({ project: await projects.updateProject(res.locals.user.id, projectId, updateDetailsSchema.parse(req.body)) });
});
