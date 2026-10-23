import { Router } from 'express';
import { database } from '../../config/database.js';
import { authenticate, type AuthLocals } from '../../middleware/authenticate.js';
import { updateProfileSchema } from '../auth/auth.schemas.js';
import { profileSelect } from './user-profile.js';

export const usersRouter = Router();
usersRouter.use(authenticate);
usersRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
usersRouter.get<Record<string, string>, unknown, unknown, Record<string, string>, AuthLocals>('/me', (_req, res) => {
  res.json({ user: res.locals.user });
});
usersRouter.patch<Record<string, string>, unknown, unknown, Record<string, string>, AuthLocals>('/me', async (req, res) => {
  const input = updateProfileSchema.parse(req.body);
  const user = await database.user.update({
    where: { id: res.locals.user.id }, data: { name: input.name }, select: profileSelect,
  });
  res.json({ user });
});
