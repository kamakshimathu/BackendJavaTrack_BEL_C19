import { randomUUID } from 'node:crypto';
import { database } from '../../config/database.js';
import { env } from '../../config/env.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../shared/app-error.js';
import { profileSelect } from '../users/user-profile.js';
import { hashRefreshToken, newRefreshToken, signAccessToken } from './tokens.js';
import { hashPassword, verifyPassword } from './passwords.js';

const invalidCredentials = () => new AppError(401, 'Invalid email or password');
const invalidRefresh = () => new AppError(401, 'Invalid or expired refresh token');

export async function register(input: { name: string; email: string; password: string }) {
  const passwordHash = await hashPassword(input.password);
  try {
    return await database.user.create({
      data: { name: input.name, email: input.email, passwordHash }, select: profileSelect,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'Email is already registered');
    }
    throw error;
  }
}

async function tokenResponse(userId: string, refreshToken: string, expiresAt: Date) {
  return {
    tokenType: 'Bearer', accessToken: await signAccessToken(userId),
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS, refreshToken, refreshExpiresAt: expiresAt.toISOString(),
  };
}

export async function login(input: { email: string; password: string }) {
  const user = await database.user.findUnique({ where: { email: input.email } });
  // Missing accounts still perform Argon2 verification to reduce timing differences.
  const valid = await verifyPassword(input.password, user?.passwordHash);
  if (!user || !valid) throw invalidCredentials();
  const refreshToken = newRefreshToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  const tokens = await tokenResponse(user.id, refreshToken, expiresAt);
  await database.refreshSession.create({
    data: { userId: user.id, familyId: randomUUID(), tokenHash: hashRefreshToken(refreshToken), expiresAt },
  });
  return tokens;
}

async function lockFamily(tx: Prisma.TransactionClient, familyId: string): Promise<void> {
  // Transaction-scoped PostgreSQL lock serializes refresh and logout for a family.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${familyId}, 0))::text`;
}

export async function refresh(refreshToken: string) {
  const tokenHash = hashRefreshToken(refreshToken);
  const existing = await database.refreshSession.findUnique({ where: { tokenHash } });
  if (!existing) throw invalidRefresh();

  const replacement = newRefreshToken();
  const tokens = await tokenResponse(existing.userId, replacement, existing.expiresAt);
  const accepted = await database.$transaction(async (tx) => {
    await lockFamily(tx, existing.familyId);
    const current = await tx.refreshSession.findUnique({ where: { tokenHash } });
    if (!current) return false;
    const now = new Date();
    if (current.revokedAt || current.expiresAt <= now) {
      // Return rather than throw so family revocation commits before HTTP 401.
      await tx.refreshSession.updateMany({
        where: { familyId: current.familyId, revokedAt: null }, data: { revokedAt: now },
      });
      return false;
    }
    const consumed = await tx.refreshSession.updateMany({
      where: { id: current.id, revokedAt: null, expiresAt: { gt: now } }, data: { revokedAt: now },
    });
    if (consumed.count !== 1) return false;
    await tx.refreshSession.create({
      data: { userId: current.userId, familyId: current.familyId,
        tokenHash: hashRefreshToken(replacement), expiresAt: current.expiresAt },
    });
    return true;
  });
  if (!accepted) throw invalidRefresh();
  return tokens;
}

export async function logout(refreshToken: string): Promise<void> {
  const existing = await database.refreshSession.findUnique({ where: { tokenHash: hashRefreshToken(refreshToken) } });
  if (!existing) return;
  await database.$transaction(async (tx) => {
    await lockFamily(tx, existing.familyId);
    await tx.refreshSession.updateMany({
      where: { familyId: existing.familyId, revokedAt: null }, data: { revokedAt: new Date() },
    });
  });
}
