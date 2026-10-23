import type { RequestHandler } from 'express';
import { database } from '../config/database.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { profileSelect, type UserProfile } from '../modules/users/user-profile.js';
import { AppError } from '../shared/app-error.js';

export interface AuthLocals { user: UserProfile }

export const authenticate: RequestHandler<Record<string, string>, unknown, unknown, Record<string, string>, AuthLocals>
  = async (req, res, next) => {
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(req.headers.authorization ?? '');
    if (!match?.[1]) throw new AppError(401, 'Authentication required');
    const userId = await verifyAccessToken(match[1]);
    const user = await database.user.findUnique({ where: { id: userId }, select: profileSelect });
    if (!user) throw new AppError(401, 'Authentication required');
    res.locals.user = user;
    next();
  };
