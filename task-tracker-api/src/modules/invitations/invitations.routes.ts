import { Router, type Response } from 'express';
import { authenticate, type AuthLocals } from '../../middleware/authenticate.js';
import { emptyQuerySchema, invitationParamsSchema, inviteSchema, paginationSchema, teamParamsSchema } from '../../shared/request-schemas.js';
import * as invitations from './invitations.service.js';

// Mounted beneath teamsRouter; inherits authentication and teamId.
export const teamInvitationsRouter = Router({ mergeParams: true });
teamInvitationsRouter.post('/', async (req, res: Response<unknown, AuthLocals>) => {
  const { teamId } = teamParamsSchema.parse(req.params);
  emptyQuerySchema.parse(req.query);
  res.status(201).json({ invitation: await invitations.createInvitation(res.locals.user.id, teamId, inviteSchema.parse(req.body).email) });
});

export const invitationsRouter = Router();
invitationsRouter.use(authenticate);
invitationsRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
invitationsRouter.get('/', async (req, res: Response<unknown, AuthLocals>) => {
  res.json(await invitations.listInvitations(res.locals.user.id, paginationSchema.parse(req.query)));
});
invitationsRouter.post('/:invitationId/accept', async (req, res: Response<unknown, AuthLocals>) => {
  const { invitationId } = invitationParamsSchema.parse(req.params);
  emptyQuerySchema.parse(req.query);
  emptyQuerySchema.parse(req.body ?? {});
  res.json({ invitation: await invitations.respondToInvitation(res.locals.user.id, invitationId, 'accept') });
});
invitationsRouter.post('/:invitationId/decline', async (req, res: Response<unknown, AuthLocals>) => {
  const { invitationId } = invitationParamsSchema.parse(req.params);
  emptyQuerySchema.parse(req.query);
  emptyQuerySchema.parse(req.body ?? {});
  res.json({ invitation: await invitations.respondToInvitation(res.locals.user.id, invitationId, 'decline') });
});
