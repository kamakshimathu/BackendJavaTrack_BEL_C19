import { Router, type Response } from 'express';
import { authenticate, type AuthLocals } from '../../middleware/authenticate.js';
import { createDetailsSchema, updateDetailsSchema, paginationSchema, emptyQuerySchema,
  teamParamsSchema, memberParamsSchema, roleSchema } from '../../shared/request-schemas.js';
import * as teams from './teams.service.js';
import { teamInvitationsRouter } from '../invitations/invitations.routes.js';
import { teamProjectsRouter } from '../projects/projects.routes.js';

export const teamsRouter = Router();
teamsRouter.use(authenticate);
teamsRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

teamsRouter.post('/', async (req, res: Response<unknown, AuthLocals>) => {
  emptyQuerySchema.parse(req.query);
  res.status(201).json({ team: await teams.createTeam(res.locals.user.id, createDetailsSchema.parse(req.body)) });
});
teamsRouter.get('/', async (req, res: Response<unknown, AuthLocals>) => {
  res.json(await teams.listTeams(res.locals.user.id, paginationSchema.parse(req.query)));
});
teamsRouter.get('/:teamId', async (req, res: Response<unknown, AuthLocals>) => {
  const { teamId } = teamParamsSchema.parse(req.params);
  emptyQuerySchema.parse(req.query);
  res.json({ team: await teams.getTeam(res.locals.user.id, teamId) });
});
teamsRouter.patch('/:teamId', async (req, res: Response<unknown, AuthLocals>) => {
  const { teamId } = teamParamsSchema.parse(req.params);
  emptyQuerySchema.parse(req.query);
  res.json({ team: await teams.updateTeam(res.locals.user.id, teamId, updateDetailsSchema.parse(req.body)) });
});
teamsRouter.get('/:teamId/members', async (req, res: Response<unknown, AuthLocals>) => {
  const { teamId } = teamParamsSchema.parse(req.params);
  res.json(await teams.listMembers(res.locals.user.id, teamId, paginationSchema.parse(req.query)));
});
teamsRouter.patch('/:teamId/members/:userId', async (req, res: Response<unknown, AuthLocals>) => {
  const { teamId, userId } = memberParamsSchema.parse(req.params);
  emptyQuerySchema.parse(req.query);
  res.json({ member: await teams.changeRole(res.locals.user.id, teamId, userId, roleSchema.parse(req.body).role) });
});
teamsRouter.delete('/:teamId/members/:userId', async (req, res: Response<unknown, AuthLocals>) => {
  const { teamId, userId } = memberParamsSchema.parse(req.params);
  emptyQuerySchema.parse(req.query);
  emptyQuerySchema.parse(req.body ?? {});
  await teams.removeMember(res.locals.user.id, teamId, userId);
  res.status(204).end();
});

teamsRouter.use('/:teamId/invitations', teamInvitationsRouter);
teamsRouter.use('/:teamId/projects', teamProjectsRouter);
