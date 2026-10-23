import 'dotenv/config';
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';

const testUrl = process.env.TEST_DATABASE_URL;
const developmentUrl = process.env.DATABASE_URL;
let app: typeof import('../src/app.js').app;
let database: typeof import('../src/config/database.js').database;
let auth: typeof import('../src/modules/auth/auth.service.js');
let tokens: typeof import('../src/modules/auth/tokens.js');
const email = `integration-${randomUUID()}@example.com`;
const raceEmail = `integration-race-${randomUUID()}@example.com`;
const password = 'StrongPassword123!';
let userId: string;
let accessToken: string;
const credential = { name: 'Test User', email, password };
const bearer = () => `Bearer ${accessToken}`;
const safeProfile = (body: unknown) => {
  const json = JSON.stringify(body);
  assert.equal(/passwordHash|tokenHash|refreshSessions|familyId/.test(json), false);
  assert.equal(json.includes(password), false);
};

describe('PostgreSQL API integration (requires a separate *_test database)', { skip: !testUrl }, () => {
  before(async () => {
    let target: URL;
    let development: URL | undefined;
    try {
      target = new URL(testUrl!);
      development = developmentUrl ? new URL(developmentUrl) : undefined;
    } catch {
      throw new Error('Invalid test database URL configuration. Values suppressed.');
    }
    const targetName = decodeURIComponent(target.pathname.slice(1));
    assert.match(targetName, /^[a-zA-Z0-9_]+_test$/, 'TEST_DATABASE_URL must name a dedicated database ending in _test');
    assert.notEqual(targetName, development ? decodeURIComponent(development.pathname.slice(1)) : '',
      'Refusing to use the development database');
    process.env.DATABASE_URL = testUrl!;
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    process.env.JWT_ISSUER = 'integration-tests';
    process.env.JWT_AUDIENCE = 'integration-client';
    ({ app } = await import('../src/app.js'));
    ({ database } = await import('../src/config/database.js'));
    auth = await import('../src/modules/auth/auth.service.js');
    tokens = await import('../src/modules/auth/tokens.js');
    await database.$connect();
    // Migrations are applied separately by the operator, never by this suite.
    await database.refreshSession.count();
  });

  after(async () => {
    if (database) {
      // Delete only this run's uniquely named fixture, never whole tables.
      await database.user.deleteMany({ where: { email: { in: [email, raceEmail] } } });
      await database.$disconnect();
    }
  });

  test('successful registration returns sanitized profile and stores only Argon2id hash', async () => {
    const response = await request(app).post('/api/auth/register').send({ ...credential, email: email.toUpperCase() }).expect(201);
    userId = response.body.user.id;
    assert.equal(response.body.user.email, email);
    safeProfile(response.body);
    const row = await database.user.findUniqueOrThrow({ where: { id: userId } });
    assert.match(row.passwordHash, /^\$argon2id\$/);
    assert.notEqual(row.passwordHash, password);
  });
  test('duplicate registration including concurrent requests returns 409', async () => {
    await request(app).post('/api/auth/register').send(credential).expect(409);
    const responses = await Promise.all([0, 1].map(() => request(app).post('/api/auth/register').send({ ...credential, email: raceEmail })));
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  });
  test('invalid registration returns 400', async () => {
    await request(app).post('/api/auth/register').send({ ...credential, role: 'admin' }).expect(400);
  });
  test('successful login returns tokens and stores a refresh hash only', async () => {
    const response = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
    accessToken = response.body.accessToken;
    const session = await database.refreshSession.findUniqueOrThrow({ where: { tokenHash: tokens.hashRefreshToken(response.body.refreshToken) } });
    assert.notEqual(session.tokenHash, response.body.refreshToken);
    safeProfile(response.body);
    assert.equal(response.body.expiresIn, 900);
  });
  test('incorrect password and nonexistent user have identical generic 401 responses', async () => {
    const wrong = await request(app).post('/api/auth/login').send({ email, password: 'WrongPassword123!' }).expect(401);
    const missing = await request(app).post('/api/auth/login').send({ email: 'missing@example.com', password }).expect(401);
    assert.deepEqual(wrong.body, missing.body);
  });
  test('valid access token retrieves current profile; update permits name only', async () => {
    await request(app).get('/api/users/me?unexpected=true').set('Authorization', bearer()).expect(400);
    const response = await request(app).get('/api/users/me').set('Authorization', bearer()).expect(200);
    assert.equal(response.body.user.id, userId);
    safeProfile(response.body);
    const updated = await request(app).patch('/api/users/me').set('Authorization', bearer()).send({ name: 'Updated User' }).expect(200);
    assert.equal(updated.body.user.name, 'Updated User');
    safeProfile(updated.body);
    await request(app).patch('/api/users/me').set('Authorization', bearer()).send({ name: 'Oops', email: 'other@example.com' }).expect(400);
    await request(app).patch('/api/users/me').set('Authorization', bearer()).send({ passwordHash: 'oops' }).expect(400);
  });
  test('health retains real PostgreSQL connectivity', async () => {
    const response = await request(app).get('/api/health').expect(200);
    assert.equal(response.body.database, 'connected');
  });
  test('refresh rotates token; replay revokes the new token in the same family', async () => {
    const login = await auth.login({ email, password });
    const rotated = await request(app).post('/api/auth/refresh').send({ refreshToken: login.refreshToken }).expect(200);
    assert.notEqual(rotated.body.refreshToken, login.refreshToken);
    assert.equal(rotated.body.refreshExpiresAt, login.refreshExpiresAt);
    await request(app).post('/api/auth/refresh').send({ refreshToken: login.refreshToken }).expect(401);
    await request(app).post('/api/auth/refresh').send({ refreshToken: rotated.body.refreshToken }).expect(401);
  });
  test('concurrent refresh has one winner; reuse revokes its replacement', async () => {
    const login = await auth.login({ email, password });
    const responses = await Promise.all([0, 1].map(() => request(app).post('/api/auth/refresh').send({ refreshToken: login.refreshToken })));
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 401]);
    const winner = responses.find((r) => r.status === 200)!;
    await request(app).post('/api/auth/refresh').send({ refreshToken: winner.body.refreshToken }).expect(401);
    const families = await database.refreshSession.findMany({ where: { tokenHash: tokens.hashRefreshToken(login.refreshToken) } });
    assert.equal(await database.refreshSession.count({ where: { familyId: families[0]!.familyId, revokedAt: null } }), 0);
  });
  test('invalid and expired refresh tokens fail', async () => {
    await request(app).post('/api/auth/refresh').send({ refreshToken: tokens.newRefreshToken() }).expect(401);
    const login = await auth.login({ email, password });
    await database.refreshSession.update({ where: { tokenHash: tokens.hashRefreshToken(login.refreshToken) }, data: { expiresAt: new Date(0) } });
    await request(app).post('/api/auth/refresh').send({ refreshToken: login.refreshToken }).expect(401);
  });
  test('logout is retryable, blocks refresh, and leaves issued access JWT valid', async () => {
    const login = await auth.login({ email, password });
    for (let i = 0; i < 2; i++) await request(app).post('/api/auth/logout').send({ refreshToken: login.refreshToken }).expect(204);
    await request(app).post('/api/auth/logout').send({ refreshToken: tokens.newRefreshToken() }).expect(204);
    await request(app).post('/api/auth/refresh').send({ refreshToken: login.refreshToken }).expect(401);
    await request(app).get('/api/users/me').set('Authorization', `Bearer ${login.accessToken}`).expect(200);
  });
  test('logout racing refresh leaves no usable refresh session in the family', async () => {
    const login = await auth.login({ email, password });
    const original = await database.refreshSession.findUniqueOrThrow({ where: { tokenHash: tokens.hashRefreshToken(login.refreshToken) } });
    const [rotation] = await Promise.all([
      request(app).post('/api/auth/refresh').send({ refreshToken: login.refreshToken }),
      request(app).post('/api/auth/logout').send({ refreshToken: login.refreshToken }).expect(204),
    ]);
    assert.ok([200, 401].includes(rotation.status));
    assert.equal(await database.refreshSession.count({ where: { familyId: original.familyId, revokedAt: null } }), 0);
  });
  test('logout in one login family preserves an independent concurrent session', async () => {
    const [first, second] = await Promise.all([auth.login({ email, password }), auth.login({ email, password })]);
    await request(app).post('/api/auth/logout').send({ refreshToken: first.refreshToken }).expect(204);
    await request(app).post('/api/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
    const rotated = await request(app).post('/api/auth/refresh').send({ refreshToken: second.refreshToken }).expect(200);
    await request(app).get('/api/users/me').set('Authorization', `Bearer ${rotated.body.accessToken}`).expect(200);
  });
  test('removed user cannot use an otherwise valid access JWT', async () => {
    await database.user.delete({ where: { id: userId } });
    await request(app).get('/api/users/me').set('Authorization', bearer()).expect(401);
  });
});
