import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { SignJWT } from 'jose';

process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.JWT_ISSUER = 'security-tests';
process.env.JWT_AUDIENCE = 'security-test-client';
process.env.NODE_ENV = 'test';
const { app } = await import('../src/app.js');
const { env } = await import('../src/config/env.js');
const { signAccessToken, verifyAccessToken, newRefreshToken, hashRefreshToken } = await import('../src/modules/auth/tokens.js');
const { hashPassword, verifyPassword } = await import('../src/modules/auth/passwords.js');
const { registerSchema, updateProfileSchema } = await import('../src/modules/auth/auth.schemas.js');

test('Argon2id hashes are salted, verify correctly, and reject wrong/missing credentials', async () => {
  const password = 'StrongPassword123!';
  const first = await hashPassword(password);
  assert.match(first, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  assert.notEqual(first, await hashPassword(password));
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('wrong', first), false);
  assert.equal(await verifyPassword(password), false);
});

test('strict validation normalizes email and rejects weak passwords and mass assignment', () => {
  const input = { name: ' Test ', email: ' TEST@Example.COM ', password: 'StrongPassword123!' };
  assert.equal(registerSchema.parse(input).email, 'test@example.com');
  assert.equal(registerSchema.parse(input).name, 'Test');
  for (const password of ['short', 'a'.repeat(129), 'lowercasepassword123!']) {
    assert.equal(registerSchema.safeParse({ ...input, password }).success, false);
  }
  assert.equal(registerSchema.safeParse({ ...input, role: 'admin' }).success, false);
  assert.equal(updateProfileSchema.safeParse({ name: 'New', passwordHash: 'x' }).success, false);
  assert.equal(updateProfileSchema.safeParse({}).success, false);
});

test('access JWT roundtrip and cryptographically random refresh tokens', async () => {
  const id = randomUUID();
  assert.equal(await verifyAccessToken(await signAccessToken(id)), id);
  const refresh = newRefreshToken();
  assert.equal(refresh.length, 43);
  assert.notEqual(refresh, newRefreshToken());
  assert.match(hashRefreshToken(refresh), /^[a-f0-9]{64}$/);
  assert.notEqual(hashRefreshToken(refresh), refresh);
});

test('JWT verification rejects expired, wrong algorithm/issuer/audience/type/signature and missing claims', async () => {
  const key = Buffer.from(env.JWT_SECRET, 'hex');
  for (const variant of ['expired', 'algorithm', 'issuer', 'audience', 'type', 'signature', 'claims', 'header']) {
    const jwt = new SignJWT(variant === 'claims' ? {} : { token_use: variant === 'type' ? 'refresh' : 'access' })
      .setProtectedHeader({ alg: variant === 'algorithm' ? 'HS512' : 'HS256', typ: variant === 'header' ? 'JWT' : 'at+jwt' })
      .setSubject(randomUUID()).setIssuedAt().setJti(randomUUID())
      .setIssuer(variant === 'issuer' ? 'other' : env.JWT_ISSUER)
      .setAudience(variant === 'audience' ? 'other' : env.JWT_AUDIENCE)
      .setExpirationTime(variant === 'expired' ? Math.floor(Date.now() / 1000) - 1 : '15m');
    const token = await jwt.sign(variant === 'signature' ? randomBytes(64) : key);
    await assert.rejects(verifyAccessToken(token), { status: 401 });
    await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`).expect(401);
  }
  await assert.rejects(verifyAccessToken(newRefreshToken()), { status: 401 });
});

test('HTTP middleware rejects missing/invalid tokens, unknown fields, bad JSON and preserves 404', async () => {
  await request(app).get('/api/users/me').expect(401);
  await request(app).get('/api/users/me').set('Authorization', 'Bearer invalid').expect(401);
  await request(app).get('/api/users/me').set('Authorization', `Bearer ${newRefreshToken()}`).expect(401);
  await request(app).post('/api/auth/register').send({ name: 'Test', email: 'invalid', password: 'weak' }).expect(400);
  await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{').expect(400);
  await request(app).get('/missing').expect(404);
  await request(app).get('/api/health?unexpected=true').expect(400);
  await request(app).post('/api/auth/login?unexpected=true').send({}).expect(400);
});

test('authentication rate limiter returns consistent JSON 429', async () => {
  let status = 0;
  for (let i = 0; i < 21; i++) {
    const response = await request(app).post('/api/auth/login').send({});
    status = response.status;
    if (status === 429) { assert.equal(typeof response.body.error.message, 'string'); break; }
  }
  assert.equal(status, 429);
});
