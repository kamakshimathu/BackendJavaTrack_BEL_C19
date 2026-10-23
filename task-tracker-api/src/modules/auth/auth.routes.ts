import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { registerSchema, loginSchema, refreshSchema } from './auth.schemas.js';
import * as auth from './auth.service.js';
import { emptyQuerySchema } from '../../shared/request-schemas.js';

export const authRouter = Router();
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: { message: 'Too many authentication attempts; try again later' } },
});
const sessionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: { message: 'Too many authentication attempts; try again later' } },
});

authRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
authRouter.use((req, _res, next) => { emptyQuerySchema.parse(req.query); next(); });
authRouter.post('/register', credentialLimiter, async (req, res) => {
  res.status(201).json({ user: await auth.register(registerSchema.parse(req.body)) });
});
authRouter.post('/login', credentialLimiter, async (req, res) => {
  res.json(await auth.login(loginSchema.parse(req.body)));
});
authRouter.post('/refresh', sessionLimiter, async (req, res) => {
  res.json(await auth.refresh(refreshSchema.parse(req.body).refreshToken));
});
authRouter.post('/logout', sessionLimiter, async (req, res) => {
  await auth.logout(refreshSchema.parse(req.body).refreshToken);
  res.status(204).end();
});
