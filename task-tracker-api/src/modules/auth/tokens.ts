import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../../shared/app-error.js';

const key = Buffer.from(env.JWT_SECRET, 'hex');

export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({ token_use: 'access' })
    .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
    .setSubject(userId).setIssuer(env.JWT_ISSUER).setAudience(env.JWT_AUDIENCE)
    .setIssuedAt().setJti(randomUUID())
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`).sign(key);
}

export async function verifyAccessToken(token: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'], issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE,
      typ: 'at+jwt', requiredClaims: ['sub', 'exp', 'iat', 'jti', 'token_use'],
      maxTokenAge: `${env.ACCESS_TOKEN_TTL_SECONDS}s`,
    });
    if (payload.token_use !== 'access' || !z.uuid().safeParse(payload.sub).success) {
      throw new Error('Invalid claims');
    }
    return payload.sub!;
  } catch {
    throw new AppError(401, 'Authentication required');
  }
}

export const newRefreshToken = (): string => randomBytes(32).toString('base64url');
export const hashRefreshToken = (token: string): string => createHash('sha256').update(token).digest('hex');
