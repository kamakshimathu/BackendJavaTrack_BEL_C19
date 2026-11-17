import 'dotenv/config';
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';

const testUrl = process.env.TEST_DATABASE_URL;
const developmentUrl = process.env.DATABASE_URL;
let app: typeof import('../src/app.js').app;
let database: typeof import('../src/config/database.js').database;
let teams: typeof import('../src/modules/teams/teams.service.js');
let invitations: typeof import('../src/modules/invitations/invitations.service.js');
let projects: typeof import('../src/modules/projects/projects.service.js');
type Actor = { id: string; email: string; token: string };
const actors = {} as Record<'owner' | 'admin' | 'admin2' | 'member' | 'outsider' | 'invitee' | 'declinee'
  | 'race' | 'duplicate' | 'expired' | 'emailChange' | 'temporary', Actor>;
const teamIds: string[] = [];
const userIds: string[] = [];
let teamId: string;
let otherTeamId: string;
let projectId: string;
let otherProjectId: string;
let inviteId: string;
let declineId: string;
const bearer = (actor: Actor) => `Bearer ${actor.token}`;
function safe(body: unknown) {
  assert.equal(/passwordHash|refreshToken|accessToken|tokenHash|refreshSessions/.test(JSON.stringify(body)), false);
}

describe('Milestone 3 PostgreSQL collaboration integration', { skip: !testUrl }, () => {
  before(async () => {
    let target: URL;
    let development: URL | undefined;
    try {
      target = new URL(testUrl!);
      development = developmentUrl ? new URL(developmentUrl) : undefined;
    } catch { throw new Error('Invalid database URL configuration. Values suppressed.'); }
    const targetName = decodeURIComponent(target.pathname.slice(1));
    assert.match(targetName, /^[a-zA-Z0-9_]+_test$/);
    assert.notEqual(targetName, development ? decodeURIComponent(development.pathname.slice(1)) : '', 'Refusing development database');
    process.env.DATABASE_URL = testUrl!;
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    process.env.JWT_ISSUER = 'collaboration-tests';
    process.env.JWT_AUDIENCE = 'collaboration-client';
    ({ app } = await import('../src/app.js'));
    ({ database } = await import('../src/config/database.js'));
    teams = await import('../src/modules/teams/teams.service.js');
    invitations = await import('../src/modules/invitations/invitations.service.js');
    projects = await import('../src/modules/projects/projects.service.js');
    const { hashPassword } = await import('../src/modules/auth/passwords.js');
    const { signAccessToken } = await import('../src/modules/auth/tokens.js');
    const passwordHash = await hashPassword('StrongPassword123!');
    for (const key of ['owner', 'admin', 'admin2', 'member', 'outsider', 'invitee', 'declinee', 'race', 'duplicate', 'expired', 'emailChange', 'temporary'] as const) {
      const user = await database.user.create({ data: { name: key, email: `m3-${randomUUID()}@example.com`, passwordHash } });
      userIds.push(user.id);
      actors[key] = { id: user.id, email: user.email, token: await signAccessToken(user.id) };
    }
    const team = await teams.createTeam(actors.owner.id, { name: 'Main team' });
    teamId = team.id;
    teamIds.push(teamId);
    const otherTeam = await teams.createTeam(actors.outsider.id, { name: 'Private other team' });
    otherTeamId = otherTeam.id;
    teamIds.push(otherTeamId);
    await database.teamMember.createMany({ data: [
      { teamId, userId: actors.admin.id, role: 'ADMIN' },
      { teamId, userId: actors.admin2.id, role: 'ADMIN' },
      { teamId, userId: actors.member.id, role: 'MEMBER' },
    ] });
    const otherProject = await projects.createProject(actors.outsider.id, otherTeamId, { name: 'Other private project' });
    otherProjectId = otherProject.id;
  });

  after(async () => {
    if (database) {
      await database.team.deleteMany({ where: { id: { in: teamIds } } });
      await database.user.deleteMany({ where: { id: { in: userIds } } });
      await database.$disconnect();
    }
  });

  test('all new route groups require authentication', async () => {
    for (const path of ['/api/teams', `/api/teams/${teamId}`, `/api/teams/${teamId}/members`,
      '/api/invitations', `/api/teams/${teamId}/projects`, `/api/projects/${otherProjectId}`]) {
      await request(app).get(path).expect(401);
    }
    await request(app).post('/api/teams').send({ name: 'Unauthorized' }).expect(401);
    await request(app).post(`/api/teams/${teamId}/invitations`).send({ email: actors.invitee.email }).expect(401);
  });

  test('team creation atomically assigns the authenticated OWNER', async () => {
    const response = await request(app).post('/api/teams').set('Authorization', bearer(actors.owner))
      .send({ name: ' New team ', description: 'Details' }).expect(201);
    const id = response.body.team.id as string;
    teamIds.push(id);
    assert.equal(response.body.team.name, 'New team');
    assert.equal(response.body.team.ownerId, actors.owner.id);
    assert.equal(response.body.team.role, 'OWNER');
    const member = await database.teamMember.findUniqueOrThrow({ where: { teamId_userId: { teamId: id, userId: actors.owner.id } } });
    assert.equal(member.role, 'OWNER');
    assert.equal(await database.teamMember.count({ where: { teamId: id } }), 1);
    safe(response.body);
    await request(app).post('/api/teams').set('Authorization', bearer(actors.owner))
      .send({ name: 'Forged', ownerId: actors.outsider.id }).expect(400);
  });

  test('team lists contain only my memberships and bounded pagination', async () => {
    const response = await request(app).get('/api/teams?limit=100').set('Authorization', bearer(actors.owner)).expect(200);
    assert.ok(response.body.teams.some((t: { id: string }) => t.id === teamId));
    assert.ok(response.body.teams.every((t: { id: string; role: string }) => t.id !== otherTeamId && t.role === 'OWNER'));
    const page = await request(app).get('/api/teams?page=1&limit=1').set('Authorization', bearer(actors.owner)).expect(200);
    assert.equal(page.body.teams.length, 1);
    assert.equal(page.body.pagination.total, 2);
  });

  test('nonmembers and unknown teams receive identical 404 responses', async () => {
    const denied = await request(app).get(`/api/teams/${teamId}`).set('Authorization', bearer(actors.outsider)).expect(404);
    const unknown = await request(app).get(`/api/teams/${randomUUID()}`).set('Authorization', bearer(actors.outsider)).expect(404);
    assert.deepEqual(denied.body, unknown.body);
    await request(app).patch(`/api/teams/${teamId}`).set('Authorization', bearer(actors.outsider)).send({ name: 'No' }).expect(404);
    await request(app).get(`/api/teams/${teamId}/members`).set('Authorization', bearer(actors.outsider)).expect(404);
  });

  test('OWNER and ADMIN edit details; MEMBER cannot; protected fields are rejected', async () => {
    await request(app).patch(`/api/teams/${teamId}`).set('Authorization', bearer(actors.owner)).send({ name: 'Main updated' }).expect(200);
    const response = await request(app).patch(`/api/teams/${teamId}`).set('Authorization', bearer(actors.admin)).send({ description: null }).expect(200);
    assert.equal(response.body.team.description, null);
    await request(app).patch(`/api/teams/${teamId}`).set('Authorization', bearer(actors.member)).send({ name: 'No' }).expect(403);
    await request(app).patch(`/api/teams/${teamId}`).set('Authorization', bearer(actors.owner)).send({ ownerId: actors.admin.id }).expect(400);
  });

  test('members may list sanitized member profiles and roles', async () => {
    const response = await request(app).get(`/api/teams/${teamId}/members?limit=100`).set('Authorization', bearer(actors.member)).expect(200);
    assert.equal(response.body.members.length, 4);
    assert.equal(response.body.members.find((m: { userId: string }) => m.userId === actors.owner.id).role, 'OWNER');
    assert.deepEqual(Object.keys(response.body.members[0].user).sort(), ['createdAt', 'email', 'id', 'name', 'updatedAt']);
    safe(response.body);
  });

  test('only OWNER may promote/demote MEMBER and ADMIN', async () => {
    const path = `/api/teams/${teamId}/members/${actors.member.id}`;
    await request(app).patch(path).set('Authorization', bearer(actors.admin)).send({ role: 'ADMIN' }).expect(403);
    await request(app).patch(path).set('Authorization', bearer(actors.member)).send({ role: 'ADMIN' }).expect(403);
    const promoted = await request(app).patch(path).set('Authorization', bearer(actors.owner)).send({ role: 'ADMIN' }).expect(200);
    assert.equal(promoted.body.member.role, 'ADMIN');
    safe(promoted.body);
    await request(app).patch(path).set('Authorization', bearer(actors.owner)).send({ role: 'MEMBER' }).expect(200);
  });

  test('OWNER assignment, owner demotion and owner removal are blocked', async () => {
    await request(app).patch(`/api/teams/${teamId}/members/${actors.member.id}`).set('Authorization', bearer(actors.owner)).send({ role: 'OWNER' }).expect(400);
    await request(app).patch(`/api/teams/${teamId}/members/${actors.owner.id}`).set('Authorization', bearer(actors.owner)).send({ role: 'MEMBER' }).expect(403);
    for (const actor of [actors.owner, actors.admin]) {
      await request(app).delete(`/api/teams/${teamId}/members/${actors.owner.id}`).set('Authorization', bearer(actor)).expect(403);
    }
    assert.equal(await database.teamMember.count({ where: { teamId, role: 'OWNER' } }), 1);
  });

  test('ADMIN cannot remove another ADMIN or themselves; MEMBER cannot remove another user', async () => {
    for (const userId of [actors.admin2.id, actors.admin.id]) {
      await request(app).delete(`/api/teams/${teamId}/members/${userId}`).set('Authorization', bearer(actors.admin)).expect(403);
    }
    await request(app).delete(`/api/teams/${teamId}/members/${actors.admin.id}`).set('Authorization', bearer(actors.member)).expect(403);
  });

  test('MEMBER may leave and immediately loses team access', async () => {
    await database.teamMember.create({ data: { teamId, userId: actors.temporary.id } });
    await request(app).delete(`/api/teams/${teamId}/members/${actors.temporary.id}`).set('Authorization', bearer(actors.temporary)).expect(204);
    await request(app).get(`/api/teams/${teamId}`).set('Authorization', bearer(actors.temporary)).expect(404);
  });

  test('ADMIN may remove MEMBER, and OWNER may remove ADMIN', async () => {
    await database.teamMember.create({ data: { teamId, userId: actors.temporary.id } });
    await request(app).delete(`/api/teams/${teamId}/members/${actors.temporary.id}`).set('Authorization', bearer(actors.admin)).expect(204);
    await request(app).delete(`/api/teams/${teamId}/members/${actors.admin2.id}`).set('Authorization', bearer(actors.owner)).expect(204);
  });

  test('registered invitees receive normalized seven-day invitations', async () => {
    const response = await request(app).post(`/api/teams/${teamId}/invitations`).set('Authorization', bearer(actors.owner))
      .send({ email: ` ${actors.invitee.email.toUpperCase()} ` }).expect(201);
    inviteId = response.body.invitation.id;
    assert.equal(response.body.invitation.invitedEmail, actors.invitee.email);
    assert.equal(response.body.invitation.invitedById, actors.owner.id);
    assert.equal(response.body.invitation.status, 'PENDING');
    assert.ok(Math.abs(Date.parse(response.body.invitation.expiresAt) - Date.now() - 7 * 86400000) < 5000);
    safe(response.body);
  });

  test('duplicate active invitations are rejected, including concurrent creation', async () => {
    await request(app).post(`/api/teams/${teamId}/invitations`).set('Authorization', bearer(actors.owner)).send({ email: actors.invitee.email }).expect(409);
    const responses = await Promise.all([0, 1].map(() => request(app).post(`/api/teams/${teamId}/invitations`)
      .set('Authorization', bearer(actors.owner)).send({ email: actors.declinee.email })));
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
    declineId = responses.find((r) => r.status === 201)!.body.invitation.id;
  });

  test('invitation permissions reject members, nonmembers, existing members and unregistered emails', async () => {
    const path = `/api/teams/${teamId}/invitations`;
    await request(app).post(path).set('Authorization', bearer(actors.member)).send({ email: actors.duplicate.email }).expect(403);
    await request(app).post(path).set('Authorization', bearer(actors.outsider)).send({ email: actors.duplicate.email }).expect(404);
    await request(app).post(path).set('Authorization', bearer(actors.admin)).send({ email: actors.member.email }).expect(409);
    await request(app).post(path).set('Authorization', bearer(actors.admin)).send({ email: `absent-${randomUUID()}@example.com` }).expect(404);
    await request(app).post(path).set('Authorization', bearer(actors.admin)).send({ email: actors.duplicate.email }).expect(201);
    await request(app).post(path).set('Authorization', bearer(actors.owner)).send({ email: actors.race.email, role: 'ADMIN' }).expect(400);
  });

  test('invitation lists are private to the authenticated current email', async () => {
    const response = await request(app).get('/api/invitations').set('Authorization', bearer(actors.invitee)).expect(200);
    assert.equal(response.body.invitations.length, 1);
    assert.equal(response.body.invitations[0].id, inviteId);
    assert.ok(response.body.invitations.every((i: { invitedEmail: string }) => i.invitedEmail === actors.invitee.email));
    const other = await request(app).get('/api/invitations').set('Authorization', bearer(actors.outsider)).expect(200);
    assert.equal(other.body.invitations.length, 0);
    safe(response.body);
  });

  test('only intended invitee can accept, always as MEMBER; repeated acceptance is 409', async () => {
    await request(app).post(`/api/invitations/${inviteId}/accept`).set('Authorization', bearer(actors.outsider)).expect(404);
    await request(app).post(`/api/invitations/${inviteId}/accept`).set('Authorization', bearer(actors.invitee)).send({ role: 'OWNER' }).expect(400);
    const response = await request(app).post(`/api/invitations/${inviteId}/accept`).set('Authorization', bearer(actors.invitee)).expect(200);
    assert.equal(response.body.invitation.status, 'ACCEPTED');
    const member = await database.teamMember.findUniqueOrThrow({ where: { teamId_userId: { teamId, userId: actors.invitee.id } } });
    assert.equal(member.role, 'MEMBER');
    await request(app).post(`/api/invitations/${inviteId}/accept`).set('Authorization', bearer(actors.invitee)).expect(409);
    safe(response.body);
  });

  test('concurrent acceptance creates exactly one MEMBER', async () => {
    const invitation = await invitations.createInvitation(actors.owner.id, teamId, actors.race.email);
    const responses = await Promise.all([0, 1].map(() => request(app).post(`/api/invitations/${invitation.id}/accept`).set('Authorization', bearer(actors.race))));
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    assert.equal(await database.teamMember.count({ where: { teamId, userId: actors.race.id } }), 1);
  });

  test('only intended invitee may decline; repeated decline is idempotent', async () => {
    await request(app).post(`/api/invitations/${declineId}/decline`).set('Authorization', bearer(actors.outsider)).expect(404);
    const response = await request(app).post(`/api/invitations/${declineId}/decline`).set('Authorization', bearer(actors.declinee)).expect(200);
    const repeated = await request(app).post(`/api/invitations/${declineId}/decline`).set('Authorization', bearer(actors.declinee)).expect(200);
    assert.equal(repeated.body.invitation.respondedAt, response.body.invitation.respondedAt);
    assert.equal(repeated.body.invitation.status, 'DECLINED');
    await request(app).post(`/api/invitations/${declineId}/accept`).set('Authorization', bearer(actors.declinee)).expect(409);
    assert.equal(await database.teamMember.count({ where: { teamId, userId: actors.declinee.id } }), 0);
  });

  test('expired invitations are derived on reads, persisted on rejection, and may be replaced', async () => {
    const invitation = await invitations.createInvitation(actors.owner.id, teamId, actors.expired.email);
    await database.teamInvitation.update({ where: { id: invitation.id }, data: { expiresAt: new Date(0) } });
    const response = await request(app).get('/api/invitations').set('Authorization', bearer(actors.expired)).expect(200);
    assert.equal(response.body.invitations[0].status, 'EXPIRED');
    assert.equal((await database.teamInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).status, 'PENDING');
    await request(app).post(`/api/invitations/${invitation.id}/accept`).set('Authorization', bearer(actors.expired)).expect(409);
    assert.equal((await database.teamInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).status, 'EXPIRED');
    const replacement = await invitations.createInvitation(actors.admin.id, teamId, actors.expired.email);
    assert.notEqual(replacement.id, invitation.id);
    await database.teamInvitation.update({ where: { id: replacement.id }, data: { expiresAt: new Date(0) } });
    const resent = await invitations.createInvitation(actors.admin.id, teamId, actors.expired.email);
    assert.equal((await database.teamInvitation.findUniqueOrThrow({ where: { id: replacement.id } })).status, 'EXPIRED');
    await database.teamInvitation.update({ where: { id: resent.id }, data: { expiresAt: new Date(0) } });
    await request(app).post(`/api/invitations/${resent.id}/decline`).set('Authorization', bearer(actors.expired)).expect(409);
  });

  test('current email changes hide old invitations and prevent acceptance', async () => {
    const invitation = await invitations.createInvitation(actors.owner.id, teamId, actors.emailChange.email);
    await database.user.update({ where: { id: actors.emailChange.id }, data: { email: `changed-${randomUUID()}@example.com` } });
    try {
      const response = await request(app).get('/api/invitations').set('Authorization', bearer(actors.emailChange)).expect(200);
      assert.equal(response.body.invitations.length, 0);
      await request(app).post(`/api/invitations/${invitation.id}/accept`).set('Authorization', bearer(actors.emailChange)).expect(404);
    } finally { await database.user.update({ where: { id: actors.emailChange.id }, data: { email: actors.emailChange.email } }); }
  });

  test('accepted invitation cannot be replayed to rejoin after removal', async () => {
    await teams.removeMember(actors.owner.id, teamId, actors.invitee.id);
    await request(app).post(`/api/invitations/${inviteId}/accept`).set('Authorization', bearer(actors.invitee)).expect(409);
    assert.equal(await database.teamMember.count({ where: { teamId, userId: actors.invitee.id } }), 0);
  });

  test('database constraints enforce unique membership, single OWNER and pending invitation', async () => {
    await assert.rejects(database.teamMember.create({ data: { teamId, userId: actors.member.id } }), { code: 'P2002' });
    await assert.rejects(database.teamMember.create({ data: { teamId, userId: actors.outsider.id, role: 'OWNER' } }), { code: 'P2002' });
    await assert.rejects(database.teamInvitation.create({ data: { teamId, invitedEmail: actors.duplicate.email,
      invitedById: actors.owner.id, expiresAt: new Date(Date.now() + 100000) } }), { code: 'P2002' });
  });

  test('OWNER and ADMIN create projects with server-owned identity fields', async () => {
    const response = await request(app).post(`/api/teams/${teamId}/projects`).set('Authorization', bearer(actors.owner))
      .send({ name: 'First project', description: 'Work' }).expect(201);
    projectId = response.body.project.id;
    assert.equal(response.body.project.teamId, teamId);
    assert.equal(response.body.project.createdById, actors.owner.id);
    safe(response.body);
    await request(app).post(`/api/teams/${teamId}/projects`).set('Authorization', bearer(actors.admin)).send({ name: 'Admin project' }).expect(201);
    await request(app).post(`/api/teams/${teamId}/projects`).set('Authorization', bearer(actors.member)).send({ name: 'No' }).expect(403);
    await request(app).post(`/api/teams/${teamId}/projects`).set('Authorization', bearer(actors.outsider)).send({ name: 'No' }).expect(404);
    await request(app).post(`/api/teams/${teamId}/projects`).set('Authorization', bearer(actors.owner)).send({ name: 'Forged', createdById: actors.admin.id }).expect(400);
  });

  test('project listing is scoped, ordered and paginated for all team members', async () => {
    const response = await request(app).get(`/api/teams/${teamId}/projects`).set('Authorization', bearer(actors.member)).expect(200);
    assert.equal(response.body.projects.length, 2);
    assert.ok(response.body.projects.every((p: { teamId: string }) => p.teamId === teamId));
    const keys = response.body.projects.map((p: { createdAt: string; id: string }) => `${p.createdAt}/${p.id}`);
    assert.deepEqual(keys, [...keys].sort());
    const page = await request(app).get(`/api/teams/${teamId}/projects?page=2&limit=1`).set('Authorization', bearer(actors.member)).expect(200);
    assert.equal(page.body.projects[0].id, response.body.projects[1].id);
    assert.equal(page.body.pagination.total, 2);
    await request(app).get(`/api/teams/${teamId}/projects`).set('Authorization', bearer(actors.outsider)).expect(404);
  });

  test('project access hides unknown and cross-team identities with the same 404', async () => {
    await request(app).get(`/api/projects/${projectId}`).set('Authorization', bearer(actors.member)).expect(200);
    const denied = await request(app).get(`/api/projects/${otherProjectId}`).set('Authorization', bearer(actors.owner)).expect(404);
    const unknown = await request(app).get(`/api/projects/${randomUUID()}`).set('Authorization', bearer(actors.owner)).expect(404);
    assert.deepEqual(denied.body, unknown.body);
    await request(app).get(`/api/projects/${projectId}`).set('Authorization', bearer(actors.outsider)).expect(404);
  });

  test('only owning-team managers update projects and cannot move projects or forge creators', async () => {
    const path = `/api/projects/${projectId}`;
    await request(app).patch(path).set('Authorization', bearer(actors.owner)).send({ name: 'Updated' }).expect(200);
    await request(app).patch(path).set('Authorization', bearer(actors.admin)).send({ description: null }).expect(200);
    await request(app).patch(path).set('Authorization', bearer(actors.member)).send({ name: 'No' }).expect(403);
    await request(app).patch(path).set('Authorization', bearer(actors.outsider)).send({ name: 'No' }).expect(404);
    await request(app).patch(`/api/projects/${otherProjectId}`).set('Authorization', bearer(actors.owner)).send({ name: 'No' }).expect(404);
    for (const body of [{ teamId: otherTeamId }, { createdById: actors.admin.id }, {}]) {
      await request(app).patch(path).set('Authorization', bearer(actors.owner)).send(body).expect(400);
    }
    assert.equal((await database.project.findUniqueOrThrow({ where: { id: projectId } })).teamId, teamId);
  });

  test('project names need not be globally or team-wide unique', async () => {
    await projects.createProject(actors.owner.id, teamId, { name: 'Same name' });
    await projects.createProject(actors.owner.id, teamId, { name: 'Same name' });
    await projects.createProject(actors.outsider.id, otherTeamId, { name: 'Same name' });
  });

  test('role changes take effect immediately with the same access JWT', async () => {
    await teams.changeRole(actors.owner.id, teamId, actors.admin.id, 'MEMBER');
    try {
      await request(app).post(`/api/teams/${teamId}/projects`).set('Authorization', bearer(actors.admin)).send({ name: 'No' }).expect(403);
    } finally { await teams.changeRole(actors.owner.id, teamId, actors.admin.id, 'ADMIN'); }
  });

  test('authorization is enforced even when services are called directly', async () => {
    await assert.rejects(teams.updateTeam(actors.member.id, teamId, { name: 'No' }), { status: 403 });
    await assert.rejects(teams.changeRole(actors.admin.id, teamId, actors.member.id, 'ADMIN'), { status: 403 });
    await assert.rejects(teams.removeMember(actors.member.id, teamId, actors.admin.id), { status: 403 });
    await assert.rejects(invitations.createInvitation(actors.member.id, teamId, actors.outsider.email), { status: 403 });
    await assert.rejects(projects.createProject(actors.member.id, teamId, { name: 'No' }), { status: 403 });
    await assert.rejects(projects.updateProject(actors.outsider.id, projectId, { name: 'No' }), { status: 404 });
  });

  test('malformed IDs, unknown fields, empty updates and invalid pagination consistently return 400', async () => {
    for (const path of ['/api/teams/bad', `/api/teams/${teamId}/members/bad`, '/api/projects/bad']) {
      const method = path.includes('/members/') ? 'patch' : 'get';
      const req = method === 'patch' ? request(app).patch(path).send({ role: 'ADMIN' }) : request(app).get(path);
      await req.set('Authorization', bearer(actors.owner)).expect(400);
    }
    await request(app).post('/api/invitations/bad/accept').set('Authorization', bearer(actors.owner)).expect(400);
    await request(app).patch(`/api/teams/${teamId}`).set('Authorization', bearer(actors.owner)).send({}).expect(400);
    await request(app).post('/api/teams').set('Authorization', bearer(actors.owner)).send({ name: ' ' }).expect(400);
    for (const path of ['/api/teams?limit=101', '/api/teams?page=0', '/api/teams?role=OWNER',
      '/api/invitations?limit=0', `/api/teams/${teamId}/members?sort=role`, `/api/teams/${teamId}/projects?limit=101`]) {
      await request(app).get(path).set('Authorization', bearer(actors.owner)).expect(400);
    }
    await request(app).post('/api/teams?ownerId=forged').set('Authorization', bearer(actors.owner)).send({ name: 'No' }).expect(400);
  });
});
