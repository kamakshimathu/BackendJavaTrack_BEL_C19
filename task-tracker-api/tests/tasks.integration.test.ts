import 'dotenv/config';
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import request from 'supertest';
import type { CreateTaskInput } from '../src/modules/tasks/tasks.schemas.js';

const testUrl = process.env.TEST_DATABASE_URL;
const developmentUrl = process.env.DATABASE_URL;
let app: typeof import('../src/app.js').app;
let database: typeof import('../src/config/database.js').database;
let tasks: typeof import('../src/modules/tasks/tasks.service.js');
let teams: typeof import('../src/modules/teams/teams.service.js');
let projects: typeof import('../src/modules/projects/projects.service.js');
type Actor = { id: string; token: string };
const actors = {} as Record<'owner' | 'admin' | 'creator' | 'assignee' | 'peer' | 'outsider' | 'leaving' | 'race', Actor>;
const teamIds: string[] = [];
const userIds: string[] = [];
let teamId: string;
let otherTeamId: string;
let projectId: string;
let secondProjectId: string;
let otherProjectId: string;
const bearer = (actor: Actor) => `Bearer ${actor.token}`;
const taskUrl = (id: string) => `/api/tasks/${id}`;
const projectUrl = (id = projectId) => `/api/projects/${id}/tasks`;
const makeTask = (actor = actors.creator, input: Partial<CreateTaskInput> = {}, project = projectId) =>
  tasks.createTask(actor.id, project, { title: `Task ${randomUUID()}`, ...input });
const dedicatedProject = async () => (await projects.createProject(actors.owner.id, teamId, { name: `Fixture ${randomUUID()}` })).id;
function safe(body: unknown) {
  assert.equal(/passwordHash|refreshToken|accessToken|tokenHash|refreshSessions|@example.com/.test(JSON.stringify(body)), false);
}

describe('Milestone 4 PostgreSQL task integration', { skip: !testUrl }, () => {
  before(async () => {
    let target: URL;
    let development: URL | undefined;
    try {
      target = new URL(testUrl!);
      development = developmentUrl ? new URL(developmentUrl) : undefined;
    } catch { throw new Error('Invalid database URL configuration. Values suppressed.'); }
    const name = decodeURIComponent(target.pathname.slice(1));
    assert.match(name, /^[a-zA-Z0-9_]+_test$/);
    assert.notEqual(name, development ? decodeURIComponent(development.pathname.slice(1)) : '', 'Refusing development database');
    process.env.DATABASE_URL = testUrl!;
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    process.env.JWT_ISSUER = 'task-integration';
    process.env.JWT_AUDIENCE = 'task-test-client';
    ({ app } = await import('../src/app.js'));
    ({ database } = await import('../src/config/database.js'));
    tasks = await import('../src/modules/tasks/tasks.service.js');
    teams = await import('../src/modules/teams/teams.service.js');
    projects = await import('../src/modules/projects/projects.service.js');
    const { hashPassword } = await import('../src/modules/auth/passwords.js');
    const { signAccessToken } = await import('../src/modules/auth/tokens.js');
    const passwordHash = await hashPassword('StrongPassword123!');
    for (const key of ['owner', 'admin', 'creator', 'assignee', 'peer', 'outsider', 'leaving', 'race'] as const) {
      const user = await database.user.create({ data: { name: key, email: `m4-${randomUUID()}@example.com`, passwordHash } });
      userIds.push(user.id);
      actors[key] = { id: user.id, token: await signAccessToken(user.id) };
    }
    teamId = (await teams.createTeam(actors.owner.id, { name: 'Task team' })).id;
    teamIds.push(teamId);
    otherTeamId = (await teams.createTeam(actors.outsider.id, { name: 'Other task team' })).id;
    teamIds.push(otherTeamId);
    await database.teamMember.createMany({ data: [
      { teamId, userId: actors.admin.id, role: 'ADMIN' },
      ...[actors.creator, actors.assignee, actors.peer, actors.leaving].map((actor) => ({ teamId, userId: actor.id, role: 'MEMBER' as const })),
      ...[actors.assignee, actors.leaving].map((actor) => ({ teamId: otherTeamId, userId: actor.id, role: 'MEMBER' as const })),
    ] });
    projectId = (await projects.createProject(actors.owner.id, teamId, { name: 'Task project' })).id;
    secondProjectId = await dedicatedProject();
    otherProjectId = (await projects.createProject(actors.outsider.id, otherTeamId, { name: 'Other project' })).id;
  });

  after(async () => {
    if (database) {
      await database.team.deleteMany({ where: { id: { in: teamIds } } });
      await database.user.deleteMany({ where: { id: { in: userIds } } });
      await database.$disconnect();
    }
  });

  test('project POST regression: literal network URL succeeds; empty team ID reproduces route 404', async () => {
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const response = await fetch(`${base}/api/teams/${teamId}/projects`, {
        method: 'POST', headers: { Authorization: bearer(actors.owner), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Real HTTP project' }),
      });
      assert.equal(response.status, 201);
      const body = await response.json() as { project: { id: string; teamId: string } };
      assert.equal(body.project.teamId, teamId);
      const createdTask = await fetch(`${base}/api/projects/${body.project.id}/tasks`, {
        method: 'POST', headers: { Authorization: bearer(actors.creator), 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Direct HTTP task', assignedToId: null }),
      });
      assert.equal(createdTask.status, 201);
      const missingId = await fetch(`${base}/api/teams//projects`, {
        method: 'POST', headers: { Authorization: bearer(actors.owner), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Missing variable' }),
      });
      assert.equal(missingId.status, 404);
      assert.deepEqual(await missingId.json(), { error: { message: 'Route not found' } });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  test('MEMBER creates task with trimmed title and safe defaults', async () => {
    const response = await request(app).post(projectUrl()).set('Authorization', bearer(actors.creator)).send({ title: ' Default task ' }).expect(201);
    const task = response.body.task;
    assert.equal(task.title, 'Default task');
    assert.equal(task.status, 'TODO');
    assert.equal(task.priority, 'MEDIUM');
    assert.equal(task.assignedToId, null);
    assert.equal(task.completedAt, null);
    assert.equal(task.dueDate, null);
    assert.equal(task.description, null);
    assert.equal(task.createdById, actors.creator.id);
    assert.equal(task.projectId, projectId);
    safe(response.body);
  });

  test('OWNER creates task with optional fields, timezone due date and current-team assignee', async () => {
    const response = await request(app).post(projectUrl()).set('Authorization', bearer(actors.owner)).send({
      title: 'Optional task', description: 'Details', priority: 'HIGH', dueDate: '2026-12-01T20:00:00+10:00', assignedToId: actors.assignee.id,
    }).expect(201);
    assert.equal(response.body.task.dueDate, '2026-12-01T10:00:00.000Z');
    assert.equal(response.body.task.priority, 'HIGH');
    assert.equal(response.body.task.assignedToId, actors.assignee.id);
    assert.deepEqual(Object.keys(response.body.task.assignedTo).sort(), ['id', 'name']);
    assert.deepEqual(Object.keys(response.body.task.createdBy).sort(), ['id', 'name']);
    safe(response.body);
  });

  test('invalid titles, description, priority, dates, UUIDs and client-owned fields return 400', async () => {
    for (const body of [
      { title: '' }, { title: ' ' }, { title: 'x'.repeat(201) }, { title: 'X', description: 'x'.repeat(5001) },
      { title: 'X', priority: 'CRITICAL' }, { title: 'X', dueDate: 'tomorrow' },
      { title: 'X', dueDate: '2026-02-30T10:00:00.000Z' }, { title: 'X', dueDate: '2026-12-01T10:00:00' },
      { title: 'X', assignedToId: 'bad' }, { title: 'X', projectId: otherProjectId },
      { title: 'X', createdById: actors.outsider.id }, { title: 'X', status: 'COMPLETED' },
    ]) await request(app).post(projectUrl()).set('Authorization', bearer(actors.owner)).send(body).expect(400);
    await request(app).post(projectUrl('bad')).set('Authorization', bearer(actors.owner)).send({ title: 'X' }).expect(400);
  });

  test('task routes including fixed assigned-to-me require authentication', async () => {
    const task = await makeTask();
    await request(app).post(projectUrl()).send({ title: 'No' }).expect(401);
    await request(app).get(projectUrl()).expect(401);
    await request(app).get('/api/tasks/assigned-to-me').expect(401);
    await request(app).get(taskUrl(task.id)).expect(401);
    await request(app).patch(taskUrl(task.id)).send({ title: 'No' }).expect(401);
    await request(app).delete(taskUrl(task.id)).expect(401);
  });

  test('creation and listing reject other-team and unknown projects without enumeration', async () => {
    const denied = await request(app).post(projectUrl(otherProjectId)).set('Authorization', bearer(actors.creator)).send({ title: 'No' }).expect(404);
    const missing = await request(app).post(projectUrl(randomUUID())).set('Authorization', bearer(actors.creator)).send({ title: 'No' }).expect(404);
    assert.deepEqual(denied.body, missing.body);
    await request(app).post(projectUrl()).set('Authorization', bearer(actors.outsider)).send({ title: 'No' }).expect(404);
    await request(app).get(projectUrl(otherProjectId)).set('Authorization', bearer(actors.creator)).expect(404);
  });

  test('MEMBER may explicitly request no assignee but cannot assign a user during creation', async () => {
    const response = await request(app).post(projectUrl()).set('Authorization', bearer(actors.creator))
      .send({ title: 'Explicitly unassigned', assignedToId: null }).expect(201);
    assert.equal(response.body.task.assignedToId, null);
    for (const assignedToId of [actors.creator.id, actors.assignee.id]) {
      await request(app).post(projectUrl()).set('Authorization', bearer(actors.creator)).send({ title: 'No', assignedToId }).expect(403);
    }
  });

  test('OWNER and ADMIN may assign during creation; invalid team assignees return 422', async () => {
    for (const actor of [actors.owner, actors.admin]) {
      const response = await request(app).post(projectUrl()).set('Authorization', bearer(actor))
        .send({ title: 'Assigned', assignedToId: actors.creator.id }).expect(201);
      assert.equal(response.body.task.assignedToId, actors.creator.id);
    }
    for (const assignedToId of [actors.outsider.id, randomUUID()]) {
      await request(app).post(projectUrl()).set('Authorization', bearer(actors.owner)).send({ title: 'No', assignedToId }).expect(422);
    }
  });

  test('task retrieval includes sanitized summaries and hides inaccessible identities', async () => {
    const task = await makeTask(actors.owner, { assignedToId: actors.assignee.id });
    const response = await request(app).get(taskUrl(task.id)).set('Authorization', bearer(actors.peer)).expect(200);
    assert.equal(response.body.task.id, task.id);
    safe(response.body);
    const denied = await request(app).get(taskUrl(task.id)).set('Authorization', bearer(actors.outsider)).expect(404);
    const missing = await request(app).get(taskUrl(randomUUID())).set('Authorization', bearer(actors.outsider)).expect(404);
    assert.deepEqual(denied.body, missing.body);
  });

  test('project lists contain only their own project tasks', async () => {
    const own = await makeTask(actors.creator, {}, secondProjectId);
    await makeTask(actors.outsider, {}, otherProjectId);
    const response = await request(app).get(projectUrl(secondProjectId)).set('Authorization', bearer(actors.peer)).expect(200);
    assert.equal(response.body.tasks.length, 1);
    assert.equal(response.body.tasks[0].id, own.id);
    safe(response.body);
  });

  test('pagination uses UUID ascending as a stable tie breaker in both directions', async () => {
    const project = await dedicatedProject();
    const fixture = await Promise.all([0, 1, 2].map(() => makeTask(actors.creator, {}, project)));
    await database.task.updateMany({ where: { projectId: project }, data: { createdAt: new Date('2026-01-01T00:00:00Z') } });
    const expected = fixture.map((task) => task.id).sort();
    for (const sortOrder of ['asc', 'desc']) {
      const ids: string[] = [];
      for (let page = 1; page <= 3; page++) {
        const response = await request(app).get(projectUrl(project)).set('Authorization', bearer(actors.peer))
          .query({ page, limit: 1, sortBy: 'createdAt', sortOrder }).expect(200);
        assert.equal(response.body.pagination.total, 3);
        ids.push(response.body.tasks[0].id);
      }
      assert.deepEqual(ids, expected);
    }
  });

  test('status, priority, assignment and search filters compose', async () => {
    const project = await dedicatedProject();
    const match = await makeTask(actors.owner, { title: 'Combined Search', priority: 'HIGH', assignedToId: actors.assignee.id }, project);
    await tasks.changeTaskStatus(actors.owner.id, match.id, 'IN_PROGRESS');
    await makeTask(actors.owner, { title: 'Combined Search', priority: 'LOW', assignedToId: actors.assignee.id }, project);
    await makeTask(actors.creator, { title: 'Other', priority: 'HIGH' }, project);
    const response = await request(app).get(projectUrl(project)).set('Authorization', bearer(actors.peer)).query({
      status: 'IN_PROGRESS', priority: 'HIGH', assignedToId: actors.assignee.id, search: 'combined', sortBy: 'priority', sortOrder: 'desc', limit: 1,
    }).expect(200);
    assert.deepEqual(response.body.tasks.map((task: { id: string }) => task.id), [match.id]);
  });

  test('search matches title and description case-insensitively', async () => {
    const project = await dedicatedProject();
    const title = await makeTask(actors.creator, { title: 'AUTHENTICATION endpoint' }, project);
    const description = await makeTask(actors.creator, { title: 'Other', description: 'Write DoCuMeNtAtIoN' }, project);
    await makeTask(actors.creator, { title: 'Unrelated' }, project);
    for (const [search, id] of [['authentication', title.id], ['DOCUMENTATION', description.id]]) {
      const response = await request(app).get(projectUrl(project)).set('Authorization', bearer(actors.peer)).query({ search }).expect(200);
      assert.deepEqual(response.body.tasks.map((task: { id: string }) => task.id), [id]);
    }
  });

  test('SQL payloads and LIKE wildcards are literal search text, never query syntax', async () => {
    const project = await dedicatedProject();
    for (const search of ["' OR 1=1 --", '%', '_', '\\']) {
      const task = await makeTask(actors.creator, { title: `Literal ${search}` }, project);
      const response = await request(app).get(projectUrl(project)).set('Authorization', bearer(actors.peer)).query({ search }).expect(200);
      assert.deepEqual(response.body.tasks.map((row: { id: string }) => row.id), [task.id]);
    }
    assert.equal(await database.task.count({ where: { projectId: project } }), 4);
  });

  test('assignee filter includes explicit null for unassigned tasks', async () => {
    const project = await dedicatedProject();
    const unassigned = await makeTask(actors.creator, {}, project);
    const assigned = await makeTask(actors.owner, { assignedToId: actors.assignee.id }, project);
    for (const [assignedToId, id] of [['null', unassigned.id], [actors.assignee.id, assigned.id]]) {
      const response = await request(app).get(projectUrl(project)).set('Authorization', bearer(actors.peer)).query({ assignedToId }).expect(200);
      assert.deepEqual(response.body.tasks.map((task: { id: string }) => task.id), [id]);
    }
  });

  test('due-date ordering puts nulls last for both ascending and descending', async () => {
    const project = await dedicatedProject();
    const early = await makeTask(actors.creator, { dueDate: new Date('2026-11-01T00:00:00Z') }, project);
    const late = await makeTask(actors.creator, { dueDate: new Date('2026-12-01T00:00:00Z') }, project);
    const none = await makeTask(actors.creator, {}, project);
    for (const sortOrder of ['asc', 'desc']) {
      const response = await request(app).get(projectUrl(project)).set('Authorization', bearer(actors.peer)).query({ sortBy: 'dueDate', sortOrder }).expect(200);
      assert.deepEqual(response.body.tasks.map((task: { id: string }) => task.id), sortOrder === 'asc' ? [early.id, late.id, none.id] : [late.id, early.id, none.id]);
    }
  });

  test('priority and status use declared business order, and updatedAt sorting works', async () => {
    const project = await dedicatedProject();
    const low = await makeTask(actors.creator, { priority: 'LOW' }, project);
    const high = await makeTask(actors.creator, { priority: 'HIGH' }, project);
    const urgent = await makeTask(actors.creator, { priority: 'URGENT' }, project);
    await tasks.changeTaskStatus(actors.creator.id, high.id, 'IN_PROGRESS');
    await tasks.changeTaskStatus(actors.creator.id, urgent.id, 'COMPLETED');
    for (const sortBy of ['priority', 'status']) {
      for (const sortOrder of ['asc', 'desc']) {
        const response = await request(app).get(projectUrl(project)).set('Authorization', bearer(actors.peer)).query({ sortBy, sortOrder }).expect(200);
        assert.deepEqual(response.body.tasks.map((task: { id: string }) => task.id), sortOrder === 'asc' ? [low.id, high.id, urgent.id] : [urgent.id, high.id, low.id]);
      }
    }
    await database.task.update({ where: { id: low.id }, data: { updatedAt: new Date('2025-01-01T00:00:00Z') } });
    const response = await request(app).get(projectUrl(project)).set('Authorization', bearer(actors.peer)).query({ sortBy: 'updatedAt', sortOrder: 'asc' }).expect(200);
    assert.equal(response.body.tasks[0].id, low.id);
  });

  test('invalid filters, pagination, sort keys and unknown query parameters return 400', async () => {
    for (const query of [{ page: 0 }, { limit: 101 }, { priority: 'BAD' }, { status: 'DONE' }, { search: ' ' },
      { assignedToId: 'bad' }, { sortBy: 'title;DROP TABLE' }, { sortOrder: 'up' }, { role: 'OWNER' }]) {
      await request(app).get(projectUrl()).set('Authorization', bearer(actors.creator)).query(query).expect(400);
    }
    await request(app).get('/api/tasks/assigned-to-me?projectId=bad').set('Authorization', bearer(actors.assignee)).expect(400);
    await request(app).get('/api/tasks/bad').set('Authorization', bearer(actors.creator)).expect(400);
  });

  test('assigned-to-me is a fixed route and spans only currently authorized teams', async () => {
    const first = await makeTask(actors.owner, { title: 'AcrossAssigned', priority: 'HIGH', assignedToId: actors.assignee.id });
    const second = await makeTask(actors.outsider, { title: 'AcrossAssigned', priority: 'HIGH', assignedToId: actors.assignee.id }, otherProjectId);
    await makeTask(actors.owner, { title: 'AcrossAssigned', assignedToId: actors.peer.id });
    const response = await request(app).get('/api/tasks/assigned-to-me').set('Authorization', bearer(actors.assignee))
      .query({ search: 'acrossassigned', status: 'TODO', priority: 'HIGH', sortBy: 'dueDate', limit: 100 }).expect(200);
    assert.deepEqual(response.body.tasks.map((task: { id: string }) => task.id).sort(), [first.id, second.id].sort());
    const filtered = await request(app).get('/api/tasks/assigned-to-me').set('Authorization', bearer(actors.assignee))
      .query({ search: 'AcrossAssigned', projectId: otherProjectId }).expect(200);
    assert.equal(filtered.body.tasks.length, 1);
    safe(response.body);
  });

  test('assigned-to-me database authorization excludes stale assignments outside membership', async () => {
    // Simulate an out-of-band stale record to verify defensive read authorization.
    const stale = await database.task.create({ data: { title: 'Stale task fixture', projectId: otherProjectId,
      createdById: actors.outsider.id, assignedToId: actors.peer.id } });
    const response = await request(app).get('/api/tasks/assigned-to-me').set('Authorization', bearer(actors.peer)).expect(200);
    assert.ok(response.body.tasks.every((task: { id: string }) => task.id !== stale.id));
    await database.task.delete({ where: { id: stale.id } });
  });

  test('creator may edit own task, including clearing description and due date', async () => {
    const task = await makeTask(actors.creator, { description: 'Details', dueDate: new Date() });
    const response = await request(app).patch(taskUrl(task.id)).set('Authorization', bearer(actors.creator))
      .send({ title: ' Updated ', priority: 'URGENT', description: null, dueDate: null }).expect(200);
    assert.equal(response.body.task.title, 'Updated');
    assert.equal(response.body.task.priority, 'URGENT');
    assert.equal(response.body.task.description, null);
    assert.equal(response.body.task.dueDate, null);
    safe(response.body);
  });

  test('MEMBER cannot edit another creator task, even when assigned; managers can edit', async () => {
    const task = await makeTask();
    await tasks.assignTask(actors.owner.id, task.id, actors.assignee.id);
    for (const actor of [actors.peer, actors.assignee]) {
      await request(app).patch(taskUrl(task.id)).set('Authorization', bearer(actor)).send({ title: 'No' }).expect(403);
    }
    for (const actor of [actors.owner, actors.admin]) {
      await request(app).patch(taskUrl(task.id)).set('Authorization', bearer(actor)).send({ title: 'Manager edit' }).expect(200);
    }
  });

  test('edit rejects empty updates and all protected fields', async () => {
    const task = await makeTask();
    for (const body of [{}, { projectId: otherProjectId }, { createdById: actors.outsider.id },
      { assignedToId: actors.creator.id }, { status: 'COMPLETED' }, { completedAt: new Date().toISOString() }, { dueDate: 'bad' }]) {
      await request(app).patch(taskUrl(task.id)).set('Authorization', bearer(actors.creator)).send(body).expect(400);
    }
  });

  test('managers may assign, reassign and unassign, with transactional membership validation', async () => {
    const task = await makeTask();
    for (const [actor, assignedToId] of [[actors.owner, actors.assignee.id], [actors.admin, actors.peer.id], [actors.owner, null]] as const) {
      const response = await request(app).patch(`${taskUrl(task.id)}/assignee`).set('Authorization', bearer(actor)).send({ assignedToId }).expect(200);
      assert.equal(response.body.task.assignedToId, assignedToId);
      safe(response.body);
    }
    await request(app).patch(`${taskUrl(task.id)}/assignee`).set('Authorization', bearer(actors.creator)).send({ assignedToId: actors.creator.id }).expect(403);
    for (const assignedToId of [actors.outsider.id, randomUUID()]) {
      await request(app).patch(`${taskUrl(task.id)}/assignee`).set('Authorization', bearer(actors.owner)).send({ assignedToId }).expect(422);
    }
    await request(app).patch(`${taskUrl(task.id)}/assignee`).set('Authorization', bearer(actors.owner)).send({ assignedToId: 'bad' }).expect(400);
  });

  test('creator, assignee and managers may change status; unrelated MEMBER may not', async () => {
    const task = await makeTask();
    await tasks.assignTask(actors.owner.id, task.id, actors.assignee.id);
    await request(app).patch(`${taskUrl(task.id)}/status`).set('Authorization', bearer(actors.peer)).send({ status: 'IN_PROGRESS' }).expect(403);
    for (const actor of [actors.creator, actors.assignee, actors.owner, actors.admin]) {
      await request(app).patch(`${taskUrl(task.id)}/status`).set('Authorization', bearer(actor)).send({ status: 'IN_PROGRESS' }).expect(200);
    }
  });

  test('completion sets server timestamp, repeated completion preserves it, reopening clears it', async () => {
    const task = await makeTask();
    const before = Date.now();
    const completed = await request(app).patch(`${taskUrl(task.id)}/status`).set('Authorization', bearer(actors.creator)).send({ status: 'COMPLETED' }).expect(200);
    const original = completed.body.task.completedAt;
    assert.ok(Date.parse(original) >= before && Date.parse(original) <= Date.now());
    const repeated = await request(app).patch(`${taskUrl(task.id)}/status`).set('Authorization', bearer(actors.creator)).send({ status: 'COMPLETED' }).expect(200);
    assert.equal(repeated.body.task.completedAt, original);
    for (const status of ['IN_PROGRESS', 'TODO']) {
      const reopened = await request(app).patch(`${taskUrl(task.id)}/status`).set('Authorization', bearer(actors.creator)).send({ status }).expect(200);
      assert.equal(reopened.body.task.completedAt, null);
    }
    const again = await tasks.changeTaskStatus(actors.creator.id, task.id, 'COMPLETED');
    assert.ok(again.completedAt!.getTime() >= Date.parse(original));
  });

  test('concurrent completions preserve one timestamp and database CHECK rejects inconsistent state', async () => {
    const task = await makeTask();
    const responses = await Promise.all([actors.owner, actors.creator].map((actor) => request(app).patch(`${taskUrl(task.id)}/status`)
      .set('Authorization', bearer(actor)).send({ status: 'COMPLETED' }).expect(200)));
    assert.equal(responses[0]!.body.task.completedAt, responses[1]!.body.task.completedAt);
    await assert.rejects(database.task.update({ where: { id: task.id }, data: { status: 'TODO' } }));
    assert.equal((await database.task.findUniqueOrThrow({ where: { id: task.id } })).status, 'COMPLETED');
  });

  test('status endpoint rejects invalid values and mass assignment', async () => {
    const task = await makeTask();
    for (const body of [{ status: 'DONE' }, {}, { status: 'TODO', completedAt: new Date().toISOString() }]) {
      await request(app).patch(`${taskUrl(task.id)}/status`).set('Authorization', bearer(actors.creator)).send(body).expect(400);
    }
  });

  test('creator and managers delete tasks without deleting parent resources', async () => {
    for (const actor of [actors.creator, actors.owner, actors.admin]) {
      const task = await makeTask();
      await request(app).delete(taskUrl(task.id)).set('Authorization', bearer(actor)).expect(204);
      await request(app).get(taskUrl(task.id)).set('Authorization', bearer(actors.owner)).expect(404);
    }
    assert.ok(await database.project.findUnique({ where: { id: projectId } }));
    assert.ok(await database.team.findUnique({ where: { id: teamId } }));
    assert.ok(await database.user.findUnique({ where: { id: actors.creator.id } }));
  });

  test('delete hides unknown, cross-team and noncreator MEMBER tasks with identical 404', async () => {
    const task = await makeTask();
    await tasks.assignTask(actors.owner.id, task.id, actors.assignee.id);
    const unknown = await request(app).delete(taskUrl(randomUUID())).set('Authorization', bearer(actors.peer)).expect(404);
    for (const actor of [actors.peer, actors.assignee, actors.outsider]) {
      const response = await request(app).delete(taskUrl(task.id)).set('Authorization', bearer(actor)).expect(404);
      assert.deepEqual(response.body, unknown.body);
    }
  });

  test('removal atomically unassigns all team projects and preserves assignments in other teams', async () => {
    const first = await makeTask(actors.owner, { title: 'RemovalPolicy', assignedToId: actors.leaving.id });
    const second = await makeTask(actors.owner, { title: 'RemovalPolicy', assignedToId: actors.leaving.id }, secondProjectId);
    const foreign = await makeTask(actors.outsider, { title: 'RemovalPolicy', assignedToId: actors.leaving.id }, otherProjectId);
    await request(app).delete(`/api/teams/${teamId}/members/${actors.leaving.id}`).set('Authorization', bearer(actors.owner)).expect(204);
    for (const task of [first, second]) assert.equal((await database.task.findUniqueOrThrow({ where: { id: task.id } })).assignedToId, null);
    assert.equal((await database.task.findUniqueOrThrow({ where: { id: foreign.id } })).assignedToId, actors.leaving.id);
    const response = await request(app).get('/api/tasks/assigned-to-me').set('Authorization', bearer(actors.leaving)).query({ search: 'RemovalPolicy' }).expect(200);
    assert.deepEqual(response.body.tasks.map((task: { id: string }) => task.id), [foreign.id]);
    await request(app).get(taskUrl(first.id)).set('Authorization', bearer(actors.leaving)).expect(404);
  });

  test('MEMBER self-removal also clears assignments', async () => {
    await database.teamMember.create({ data: { teamId, userId: actors.leaving.id } });
    const task = await makeTask(actors.owner, { assignedToId: actors.leaving.id });
    await request(app).delete(`/api/teams/${teamId}/members/${actors.leaving.id}`).set('Authorization', bearer(actors.leaving)).expect(204);
    assert.equal((await database.task.findUniqueOrThrow({ where: { id: task.id } })).assignedToId, null);
  });

  test('assignment versus removal races never leave an active out-of-team assignee', async () => {
    for (let iteration = 0; iteration < 3; iteration++) {
      await database.teamMember.create({ data: { teamId, userId: actors.race.id } });
      const task = await makeTask();
      const [assignment] = await Promise.all([
        request(app).patch(`${taskUrl(task.id)}/assignee`).set('Authorization', bearer(actors.owner)).send({ assignedToId: actors.race.id }),
        request(app).delete(`/api/teams/${teamId}/members/${actors.race.id}`).set('Authorization', bearer(actors.owner)).expect(204),
      ]);
      assert.ok([200, 422].includes(assignment.status));
      assert.equal((await database.task.findUniqueOrThrow({ where: { id: task.id } })).assignedToId, null);
      assert.equal(await database.teamMember.count({ where: { teamId, userId: actors.race.id } }), 0);
    }
  });

  test('assigned creation versus removal also preserves membership integrity', async () => {
    await database.teamMember.create({ data: { teamId, userId: actors.race.id } });
    const [creation] = await Promise.all([
      request(app).post(projectUrl()).set('Authorization', bearer(actors.admin)).send({ title: 'Creation race', assignedToId: actors.race.id }),
      request(app).delete(`/api/teams/${teamId}/members/${actors.race.id}`).set('Authorization', bearer(actors.owner)).expect(204),
    ]);
    assert.ok([201, 422].includes(creation.status));
    assert.equal(await database.task.count({ where: { assignedToId: actors.race.id, project: { teamId } } }), 0);
  });

  test('service calls enforce task permissions without route middleware', async () => {
    const task = await makeTask();
    await assert.rejects(tasks.updateTask(actors.peer.id, task.id, { title: 'No' }), { status: 403 });
    await assert.rejects(tasks.assignTask(actors.creator.id, task.id, actors.creator.id), { status: 403 });
    await assert.rejects(tasks.changeTaskStatus(actors.peer.id, task.id, 'COMPLETED'), { status: 403 });
    await assert.rejects(tasks.deleteTask(actors.peer.id, task.id), { status: 404 });
    await assert.rejects(tasks.createTask(actors.outsider.id, projectId, { title: 'No' }), { status: 404 });
  });

  test('removed creators retain task history but lose task read and write access', async () => {
    const task = await makeTask(actors.peer);
    await teams.removeMember(actors.owner.id, teamId, actors.peer.id);
    await request(app).get(taskUrl(task.id)).set('Authorization', bearer(actors.peer)).expect(404);
    await request(app).patch(taskUrl(task.id)).set('Authorization', bearer(actors.peer)).send({ title: 'No' }).expect(404);
    await request(app).patch(`${taskUrl(task.id)}/status`).set('Authorization', bearer(actors.peer)).send({ status: 'COMPLETED' }).expect(404);
    const response = await request(app).get(taskUrl(task.id)).set('Authorization', bearer(actors.owner)).expect(200);
    assert.equal(response.body.task.createdById, actors.peer.id);
  });
});
