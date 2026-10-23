import 'dotenv/config';
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import request from 'supertest';

const testUrl = process.env.TEST_DATABASE_URL;
const developmentUrl = process.env.DATABASE_URL;
let app: typeof import('../src/app.js').app;
let database: typeof import('../src/config/database.js').database;
let tasks: typeof import('../src/modules/tasks/tasks.service.js');
let teams: typeof import('../src/modules/teams/teams.service.js');
let projects: typeof import('../src/modules/projects/projects.service.js');
let attachments: typeof import('../src/modules/attachments/attachments.service.js');
let comments: typeof import('../src/modules/comments/comments.service.js');
let storage: typeof import('../src/services/storage/local-storage.js').storage;
let cleanup: typeof import('../src/services/storage/file-cleanup.js');
let storageRoot: string;
let originalSave: typeof storage.save;
let originalDelete: typeof storage.delete;
const keys = new Set<string>();
type Actor = { id: string; token: string };
const actors = {} as Record<'owner' | 'admin' | 'author' | 'peer' | 'outsider' | 'leaving', Actor>;
const userIds: string[] = [];
const teamIds: string[] = [];
let teamId: string;
let projectId: string;
let taskId: string;
let jpeg: Buffer;
const txt = Buffer.from('Hello UTF-8 world!\n');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=', 'base64');
function blankPdf(): Buffer {
  let body = '%PDF-1.4\n';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>'];
  const offsets = [0];
  objects.forEach((value, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${value}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += 'xref\n0 4\n0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}
const pdf = blankPdf();
const bearer = (actor: Actor) => `Bearer ${actor.token}`;
const commentUrl = (id = taskId) => `/api/tasks/${id}/comments`;
const attachmentUrl = (id = taskId) => `/api/tasks/${id}/attachments`;
const safe = (body: unknown) => {
  const json = JSON.stringify(body);
  assert.equal(/passwordHash|tokenHash|accessToken|refreshToken|storageKey|@example.com/.test(json), false);
  assert.equal(json.includes(storageRoot), false);
};
const upload = (actor = actors.author, filename = 'notes.txt', buffer: Buffer = txt, mime = 'text/plain', task = taskId) =>
  request(app).post(attachmentUrl(task)).set('Authorization', bearer(actor)).attach('file', buffer, { filename, contentType: mime });
const rowFor = (id: string) => database.taskAttachment.findUniqueOrThrow({ where: { id } });
const files = async () => { try { return (await readdir(storageRoot)).sort(); } catch { return []; } };
const exists = async (path: string) => { try { await access(path); return true; } catch { return false; } };

describe('Milestone 5 PostgreSQL comments and private attachments', { skip: !testUrl }, () => {
  before(async () => {
    let target: URL;
    let development: URL | undefined;
    try { target = new URL(testUrl!); development = developmentUrl ? new URL(developmentUrl) : undefined; }
    catch { throw new Error('Invalid database URL configuration. Values suppressed.'); }
    const name = decodeURIComponent(target.pathname.slice(1));
    assert.match(name, /^[a-zA-Z0-9_]+_test$/);
    assert.notEqual(name, development ? decodeURIComponent(development.pathname.slice(1)) : '', 'Refusing development database');
    storageRoot = await mkdtemp(join(tmpdir(), 'task-tracker-m5-'));
    process.env.UPLOAD_DIR = storageRoot;
    process.env.DATABASE_URL = testUrl!;
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    process.env.JWT_ISSUER = 'discussion-tests';
    process.env.JWT_AUDIENCE = 'discussion-client';
    ({ app } = await import('../src/app.js'));
    ({ database } = await import('../src/config/database.js'));
    tasks = await import('../src/modules/tasks/tasks.service.js');
    teams = await import('../src/modules/teams/teams.service.js');
    projects = await import('../src/modules/projects/projects.service.js');
    attachments = await import('../src/modules/attachments/attachments.service.js');
    comments = await import('../src/modules/comments/comments.service.js');
    ({ storage } = await import('../src/services/storage/local-storage.js'));
    cleanup = await import('../src/services/storage/file-cleanup.js');
    originalSave = storage.save.bind(storage);
    originalDelete = storage.delete.bind(storage);
    storage.save = async (key, buffer) => { keys.add(key); await originalSave(key, buffer); };
    const { hashPassword } = await import('../src/modules/auth/passwords.js');
    const { signAccessToken } = await import('../src/modules/auth/tokens.js');
    const passwordHash = await hashPassword('StrongPassword123!');
    for (const key of ['owner', 'admin', 'author', 'peer', 'outsider', 'leaving'] as const) {
      const user = await database.user.create({ data: { name: key, email: `m5-${randomUUID()}@example.com`, passwordHash } });
      userIds.push(user.id);
      actors[key] = { id: user.id, token: await signAccessToken(user.id) };
    }
    teamId = (await teams.createTeam(actors.owner.id, { name: 'Discussion team' })).id;
    teamIds.push(teamId);
    await database.teamMember.createMany({ data: [
      { teamId, userId: actors.admin.id, role: 'ADMIN' },
      ...[actors.author, actors.peer, actors.leaving].map((actor) => ({ teamId, userId: actor.id, role: 'MEMBER' as const })),
    ] });
    projectId = (await projects.createProject(actors.owner.id, teamId, { name: 'Discussion' })).id;
    taskId = (await tasks.createTask(actors.author.id, projectId, { title: 'Review' })).id;
    jpeg = await readFile(new URL('./fixtures/pixel.jpg', import.meta.url));
  });

  after(async () => {
    try {
      if (database) {
        if (originalDelete) storage.delete = originalDelete;
        await database.team.deleteMany({ where: { id: { in: teamIds } } });
        for (let batch = 0; batch < 10; batch++) {
          const result = await cleanup.cleanupFiles(100, [...keys]);
          if (!result.cleaned) break;
        }
        assert.equal(await database.fileCleanup.count({ where: { storageKey: { in: [...keys] } } }), 0);
        assert.deepEqual(await files(), []);
        await database.user.deleteMany({ where: { id: { in: userIds } } });
      }
    } finally {
      if (database) await database.$disconnect();
      if (storageRoot) {
        assert.equal(dirname(resolve(storageRoot)), resolve(tmpdir()));
        assert.ok(storageRoot.includes('task-tracker-m5-'));
        await rm(storageRoot, { recursive: true, force: true });
      }
    }
  });

  test('create trimmed comment with authenticated author and safe summary', async () => {
    const response = await request(app).post(commentUrl()).set('Authorization', bearer(actors.author)).send({ content: ' Ready for review ' }).expect(201);
    assert.equal(response.body.comment.content, 'Ready for review');
    assert.equal(response.body.comment.authorId, actors.author.id);
    assert.deepEqual(Object.keys(response.body.comment.author).sort(), ['id', 'name']);
    safe(response.body);
  });
  test('database-generated timestamps and application clock use the same UTC instant', async () => {
    const result=await database.$queryRaw<Array<{now:Date}>>`SELECT NOW() AS now`;
    assert.ok(Math.abs(result[0]!.now.getTime()-Date.now())<5000);
    const comment=await comments.createComment(actors.author.id,taskId,'UTC timestamp');
    assert.ok(Math.abs(comment.createdAt.getTime()-Date.now())<5000);
  });
  test('comment validation rejects empty/oversized/unknown fields', async () => {
    for (const body of [{ content: '' }, { content: '   ' }, { content: 'x'.repeat(5001) },
      { content: 'X', authorId: actors.owner.id }, { content: 'X', taskId }, { content: 'X', createdAt: new Date().toISOString() }]) {
      await request(app).post(commentUrl()).set('Authorization', bearer(actors.author)).send(body).expect(400);
    }
  });
  test('comment listing is chronological, paginated, task-scoped and sanitized', async () => {
    const task = await tasks.createTask(actors.author.id, projectId, { title: 'Comment pages' });
    const fixture = await Promise.all([0,1,2].map((i) => comments.createComment(actors.author.id, task.id, `Comment ${i}`)));
    await database.taskComment.updateMany({ where: { taskId: task.id }, data: { createdAt: new Date('2026-01-01T00:00:00Z') } });
    const ids: string[] = [];
    for (let page=1;page<=3;page++) {
      const response=await request(app).get(commentUrl(task.id)).set('Authorization',bearer(actors.peer)).query({page,limit:1}).expect(200);
      ids.push(response.body.comments[0].id); assert.equal(response.body.pagination.total,3); safe(response.body);
    }
    assert.deepEqual(ids,fixture.map((c)=>c.id).sort());
  });
  test('only author may edit; createdAt is preserved; OWNER/ADMIN cannot edit another author', async () => {
    const comment=await comments.createComment(actors.author.id,taskId,'Original');
    const response=await request(app).patch(`/api/comments/${comment.id}`).set('Authorization',bearer(actors.author)).send({content:' Updated '}).expect(200);
    assert.equal(response.body.comment.content,'Updated'); assert.equal(response.body.comment.createdAt,comment.createdAt.toISOString());
    for (const actor of [actors.peer,actors.owner,actors.admin]) await request(app).patch(`/api/comments/${comment.id}`).set('Authorization',bearer(actor)).send({content:'No'}).expect(403);
    await request(app).patch(`/api/comments/${comment.id}`).set('Authorization',bearer(actors.author)).send({content:'X',authorId:actors.owner.id}).expect(400);
  });
  test('author and OWNER/ADMIN may delete comments; other MEMBER may not', async () => {
    for (const actor of [actors.author,actors.owner,actors.admin]) {
      const comment=await comments.createComment(actors.author.id,taskId,'Moderation');
      await request(app).delete(`/api/comments/${comment.id}`).set('Authorization',bearer(actors.peer)).expect(403);
      await request(app).delete(`/api/comments/${comment.id}`).set('Authorization',bearer(actor)).expect(204);
    }
  });
  test('unknown and inaccessible comments/tasks are non-enumerating; authentication required', async () => {
    const comment=await comments.createComment(actors.author.id,taskId,'Private');
    await request(app).post(commentUrl()).send({content:'No'}).expect(401);
    await request(app).get(commentUrl()).set('Authorization',bearer(actors.outsider)).expect(404);
    await request(app).post(commentUrl(randomUUID())).set('Authorization',bearer(actors.author)).send({content:'No'}).expect(404);
    const denied=await request(app).patch(`/api/comments/${comment.id}`).set('Authorization',bearer(actors.outsider)).send({content:'No'}).expect(404);
    const unknown=await request(app).patch(`/api/comments/${randomUUID()}`).set('Authorization',bearer(actors.outsider)).send({content:'No'}).expect(404);
    assert.deepEqual(denied.body,unknown.body);
    await request(app).delete(`/api/comments/${comment.id}`).set('Authorization',bearer(actors.outsider)).expect(404);
  });
  test('comment SQL-looking content is stored literally, not executed', async () => {
    const content="'; DROP TABLE TaskComment; -- <script>alert(1)</script>";
    const response=await request(app).post(commentUrl()).set('Authorization',bearer(actors.author)).send({content}).expect(201);
    assert.equal(response.body.comment.content,content); safe(response.body);
    assert.ok(await database.task.findUnique({where:{id:taskId}}));
  });
  test('comment IDs and pagination are strictly validated', async () => {
    await request(app).patch('/api/comments/bad').set('Authorization',bearer(actors.author)).send({content:'X'}).expect(400);
    await request(app).get(commentUrl()).set('Authorization',bearer(actors.author)).query({limit:101}).expect(400);
    await request(app).get(commentUrl()).set('Authorization',bearer(actors.author)).query({authorId:actors.owner.id}).expect(400);
  });

  test('valid PDF, PNG, JPEG and UTF-8 TXT upload to private disk', async () => {
    for (const [name,buffer,mime] of [['document.pdf',pdf,'application/pdf'],['pixel.png',png,'image/png'],['pixel.jpg',jpeg,'image/jpeg'],['notes.txt',txt,'text/plain']] as const) {
      const response=await upload(actors.author,name,buffer,mime).expect(201);
      const row=await rowFor(response.body.attachment.id);
      assert.equal(row.uploadedById,actors.author.id); assert.equal(row.sizeBytes,buffer.length);
      assert.equal(response.body.attachment.downloadUrl,`/api/attachments/${row.id}/download`);
      assert.deepEqual(await readFile(join(storageRoot,row.storageKey)),buffer); safe(response.body);
    }
  });
  test('unsupported extensions and MIME/content mismatches are rejected', async () => {
    for (const [name,buffer,mime] of [['payload.exe',txt,'application/octet-stream'],['fake.png',txt,'image/png'],['fake.pdf',png,'application/pdf'],
      ['fake.jpg',pdf,'image/jpeg'],['notes.txt',txt,'application/pdf'],['fake.txt',png,'text/plain']] as const) await upload(actors.author,name,buffer,mime).expect(415);
  });
  test('invalid UTF-8, binary/control text and whitespace-only text are rejected', async () => {
    for (const buffer of [Buffer.from([0xff,0xfe]),Buffer.from('hello\0world'),Buffer.from('hello\u0007world'),Buffer.from(' \n\t')]) await upload(actors.author,'invalid.txt',buffer).expect(415);
  });
  test('empty and oversized files are rejected; exactly 5 MiB is accepted', async () => {
    await upload(actors.author,'empty.txt',Buffer.alloc(0)).expect(400);
    await upload(actors.author,'large.txt',Buffer.alloc(5*1024*1024+1,0x61)).expect(413);
    const response=await upload(actors.author,'limit.txt',Buffer.alloc(5*1024*1024,0x61)).expect(201);
    await request(app).delete(`/api/attachments/${response.body.attachment.id}`).set('Authorization',bearer(actors.author)).expect(204);
  });
  test('one file named file is required; extra files, fields, parts and malformed multipart are rejected', async () => {
    await request(app).post(attachmentUrl()).set('Authorization',bearer(actors.author)).attach('upload',txt,'wrong.txt').expect(400);
    await request(app).post(attachmentUrl()).set('Authorization',bearer(actors.author)).attach('file',txt,'a.txt').attach('file',txt,'b.txt').expect(400);
    await request(app).post(attachmentUrl()).set('Authorization',bearer(actors.author)).field('uploadedById',actors.owner.id).attach('file',txt,'a.txt').expect(400);
    await request(app).post(attachmentUrl()).set('Authorization',bearer(actors.author)).set('Content-Type','multipart/form-data; boundary=broken').send(Buffer.from('not a valid multipart body')).expect(400);
    await request(app).post(attachmentUrl()).set('Authorization',bearer(actors.author)).send({file:'not multipart'}).expect(415);
  });
  test('raw traversal, Windows ADS/device names and double extensions cannot become filenames', async () => {
    for (const filename of ['../secret.txt','..\\secret.txt','C:\\secret.txt','CON.txt','report.txt.exe']) {
      const boundary='testboundary';
      const body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n`),txt,Buffer.from(`\r\n--${boundary}--\r\n`)]);
      const response=await request(app).post(attachmentUrl()).set('Authorization',bearer(actors.author)).set('Content-Type',`multipart/form-data; boundary=${boundary}`).send(body);
      assert.ok([400,415].includes(response.status));
    }
  });
  test('authentication and task authorization happen before multipart parsing/storage', async () => {
    const beforeFiles=await files();
    await request(app).post(attachmentUrl()).attach('file',txt,'no.txt').expect(401);
    await request(app).post(attachmentUrl()).set('Authorization',bearer(actors.outsider)).set('Content-Type','multipart/form-data; boundary=broken').send(Buffer.from('invalid')).expect(404);
    await upload(actors.author,'unknown.txt',txt,'text/plain',randomUUID()).expect(404);
    assert.deepEqual(await files(),beforeFiles);
  });
  test('attachment listing is paginated, chronological and excludes keys, paths and credentials', async () => {
    const task=await tasks.createTask(actors.author.id,projectId,{title:'Attachment pages'});
    const fixture=[];
    for (let i=0;i<3;i++) fixture.push((await upload(actors.author,`page${i}.txt`,txt,'text/plain',task.id).expect(201)).body.attachment.id as string);
    await database.taskAttachment.updateMany({where:{taskId:task.id},data:{createdAt:new Date('2026-01-01T00:00:00Z')}});
    const ids=[];
    for (let page=1;page<=3;page++) {
      const response=await request(app).get(attachmentUrl(task.id)).set('Authorization',bearer(actors.peer)).query({page,limit:1}).expect(200);
      ids.push(response.body.attachments[0].id); assert.equal(response.body.pagination.total,3); safe(response.body);
    }
    assert.deepEqual(ids,fixture.sort());
    await request(app).get(attachmentUrl()).set('Authorization',bearer(actors.outsider)).expect(404);
  });
  test('authorized download streams bytes with attachment, nosniff and private cache headers', async () => {
    const response=await upload().expect(201);
    const downloaded=await request(app).get(response.body.attachment.downloadUrl).set('Authorization',bearer(actors.peer)).expect(200);
    assert.equal(downloaded.text,txt.toString());
    assert.match(String(downloaded.headers['content-disposition']),/^attachment;/);
    assert.equal(downloaded.headers['x-content-type-options'],'nosniff');
    assert.equal(downloaded.headers['cache-control'],'no-store');
    assert.match(String(downloaded.headers['content-security-policy']),/sandbox/);
    await request(app).get(response.body.attachment.downloadUrl).expect(401);
    await request(app).get(`/uploads/${(await rowFor(response.body.attachment.id)).storageKey}`).expect(404);
  });
  test('cross-team and unknown download/delete IDs receive identical non-enumerating 404', async () => {
    const response=await upload().expect(201);
    const id=response.body.attachment.id;
    const denied=await request(app).get(`/api/attachments/${id}/download`).set('Authorization',bearer(actors.outsider)).expect(404);
    const unknown=await request(app).get(`/api/attachments/${randomUUID()}/download`).set('Authorization',bearer(actors.outsider)).expect(404);
    assert.deepEqual(denied.body,unknown.body);
    await request(app).delete(`/api/attachments/${id}`).set('Authorization',bearer(actors.outsider)).expect(404);
  });
  test('uploader and OWNER/ADMIN delete files; another MEMBER cannot', async () => {
    for (const actor of [actors.author,actors.owner,actors.admin]) {
      const response=await upload().expect(201); const id=response.body.attachment.id; const row=await rowFor(id);
      await request(app).delete(`/api/attachments/${id}`).set('Authorization',bearer(actors.peer)).expect(403);
      await request(app).delete(`/api/attachments/${id}`).set('Authorization',bearer(actor)).expect(204);
      assert.equal(await exists(join(storageRoot,row.storageKey)),false);
      assert.equal(await database.taskAttachment.findUnique({where:{id}}),null);
      assert.equal(await database.fileCleanup.findUnique({where:{storageKey:row.storageKey}}),null);
    }
  });
  test('missing physical files produce controlled errors and deletion remains safe', async () => {
    const response=await upload().expect(201); const id=response.body.attachment.id; const row=await rowFor(id);
    await originalDelete(row.storageKey);
    const missing=await request(app).get(`/api/attachments/${id}/download`).set('Authorization',bearer(actors.author)).expect(500);
    assert.deepEqual(missing.body,{error:{message:'Stored file is unavailable'}}); safe(missing.body);
    await request(app).delete(`/api/attachments/${id}`).set('Authorization',bearer(actors.author)).expect(204);
  });
  test('forged storage keys cannot escape the directory or read/delete unrelated files', async () => {
    const response=await upload().expect(201); const id=response.body.attachment.id; const row=await rowFor(id);
    const sentinel=join(dirname(storageRoot),`task-tracker-sentinel-${randomUUID()}.txt`); await writeFile(sentinel,'KEEP');
    const forgedKey=`../${basename(sentinel)}`;
    try {
      await database.taskAttachment.update({where:{id},data:{storageKey:forgedKey}});
      const denied=await request(app).get(`/api/attachments/${id}/download`).set('Authorization',bearer(actors.author)).expect(500); safe(denied.body);
      await assert.rejects(storage.delete(forgedKey));
      assert.equal(await readFile(sentinel,'utf8'),'KEEP');
    } finally { await database.taskAttachment.update({where:{id},data:{storageKey:row.storageKey}}); await rm(sentinel); }
  });
  test('database metadata failure removes the already stored file and recovery reservation', async () => {
    const beforeFiles=await files(); const beforeCount=await database.taskAttachment.count({where:{taskId}});
    await database.$executeRawUnsafe(`CREATE FUNCTION m5_test_fail_upload() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."originalName" = 'db-failure.txt' THEN RAISE EXCEPTION 'injected persistence failure'; END IF; RETURN NEW; END; $$`);
    await database.$executeRawUnsafe('CREATE TRIGGER m5_test_fail_upload BEFORE INSERT ON "TaskAttachment" FOR EACH ROW EXECUTE FUNCTION m5_test_fail_upload()');
    try { const response=await upload(actors.author,'db-failure.txt').expect(500); safe(response.body); }
    finally { await database.$executeRawUnsafe('DROP TRIGGER m5_test_fail_upload ON "TaskAttachment"'); await database.$executeRawUnsafe('DROP FUNCTION m5_test_fail_upload()'); }
    assert.deepEqual(await files(),beforeFiles); assert.equal(await database.taskAttachment.count({where:{taskId}}),beforeCount);
  });
  test('partial storage failure leaves no attachment metadata or file', async () => {
    const beforeFiles=await files(); const beforeCount=await database.taskAttachment.count({where:{taskId}});
    const trackedSave=storage.save;
    storage.save=async (key,buffer)=>{await trackedSave(key,buffer);throw new Error('injected disk failure');};
    try { await upload(actors.author,'storage-failure.txt').expect(500); } finally { storage.save=trackedSave; }
    assert.deepEqual(await files(),beforeFiles); assert.equal(await database.taskAttachment.count({where:{taskId}}),beforeCount);
  });
  test('failed physical deletion stays queued and recovers on retry', async () => {
    const response=await upload().expect(201); const id=response.body.attachment.id; const row=await rowFor(id);
    storage.delete=async()=>{throw new Error('injected permission failure');};
    try { await request(app).delete(`/api/attachments/${id}`).set('Authorization',bearer(actors.author)).expect(204); }
    finally { storage.delete=originalDelete; }
    assert.equal(await database.taskAttachment.findUnique({where:{id}}),null);
    assert.ok(await database.fileCleanup.findUnique({where:{storageKey:row.storageKey}}));
    assert.equal(await exists(join(storageRoot,row.storageKey)),true);
    await request(app).get(`/api/attachments/${id}/download`).set('Authorization',bearer(actors.author)).expect(404);
    assert.deepEqual(await cleanup.cleanupFiles(10,[row.storageKey]),{cleaned:1,failed:0});
    assert.equal(await exists(join(storageRoot,row.storageKey)),false);
  });
  test('task deletion cascades metadata/comments and cleans stored content', async () => {
    const task=await tasks.createTask(actors.author.id,projectId,{title:'Delete with files'});
    await comments.createComment(actors.author.id,task.id,'Cascade comment');
    const response=await upload(actors.author,'cascade.txt',txt,'text/plain',task.id).expect(201); const row=await rowFor(response.body.attachment.id);
    await request(app).delete(`/api/tasks/${task.id}`).set('Authorization',bearer(actors.author)).expect(204);
    assert.equal(await database.taskComment.count({where:{taskId:task.id}}),0);
    assert.equal(await database.taskAttachment.count({where:{taskId:task.id}}),0);
    assert.equal(await exists(join(storageRoot,row.storageKey)),false);
  });
  test('project cascades queue cleanup even outside the task service', async () => {
    const project=await projects.createProject(actors.owner.id,teamId,{name:'Cascade fixture'});
    const task=await tasks.createTask(actors.author.id,project.id,{title:'Cascade task'});
    const response=await upload(actors.author,'project-cascade.txt',txt,'text/plain',task.id).expect(201); const row=await rowFor(response.body.attachment.id);
    await database.project.delete({where:{id:project.id}});
    assert.ok(await database.fileCleanup.findUnique({where:{storageKey:row.storageKey}}));
    await cleanup.cleanupFiles(10,[row.storageKey]); assert.equal(await exists(join(storageRoot,row.storageKey)),false);
  });
  test('concurrent delete/retry removes metadata and content once without inconsistent state', async () => {
    const response=await upload().expect(201); const id=response.body.attachment.id; const row=await rowFor(id);
    const responses=await Promise.all([0,1].map(()=>request(app).delete(`/api/attachments/${id}`).set('Authorization',bearer(actors.author))));
    assert.deepEqual(responses.map((r)=>r.status).sort(),[204,404]);
    await request(app).delete(`/api/attachments/${id}`).set('Authorization',bearer(actors.author)).expect(404);
    assert.equal(await exists(join(storageRoot,row.storageKey)),false);
  });
  test('expired upload reservations recover; live leases and referenced files are not deleted', async () => {
    const key=randomUUID(); keys.add(key);
    await database.fileCleanup.create({data:{storageKey:key,notBefore:new Date(Date.now()+3600000)}});
    await originalSave(key,txt);
    assert.equal((await cleanup.cleanupFiles(10,[key])).cleaned,0);
    await database.fileCleanup.update({where:{storageKey:key},data:{notBefore:new Date(0)}});
    assert.equal((await cleanup.cleanupFiles(10,[key])).cleaned,1); assert.equal(await exists(join(storageRoot,key)),false);
    const response=await upload().expect(201); const row=await rowFor(response.body.attachment.id);
    await database.fileCleanup.create({data:{storageKey:row.storageKey}});
    assert.equal((await cleanup.cleanupFiles(10,[row.storageKey])).cleaned,0);
    assert.equal(await exists(join(storageRoot,row.storageKey)),true);
  });
  test('former members lose comment and attachment access even when author/uploader', async () => {
    const comment=await comments.createComment(actors.leaving.id,taskId,'Former author');
    const response=await upload(actors.leaving,'former.txt').expect(201); const id=response.body.attachment.id;
    await teams.removeMember(actors.owner.id,teamId,actors.leaving.id);
    await request(app).get(commentUrl()).set('Authorization',bearer(actors.leaving)).expect(404);
    await request(app).patch(`/api/comments/${comment.id}`).set('Authorization',bearer(actors.leaving)).send({content:'No'}).expect(404);
    await request(app).delete(`/api/comments/${comment.id}`).set('Authorization',bearer(actors.leaving)).expect(404);
    await request(app).get(`/api/attachments/${id}/download`).set('Authorization',bearer(actors.leaving)).expect(404);
    await request(app).delete(`/api/attachments/${id}`).set('Authorization',bearer(actors.leaving)).expect(404);
  });
  test('attachment route IDs and listing query strings reject malformed/unknown values', async () => {
    await request(app).get('/api/attachments/bad/download').set('Authorization',bearer(actors.author)).expect(400);
    await request(app).get(attachmentUrl()).set('Authorization',bearer(actors.author)).query({limit:101}).expect(400);
    await request(app).get(attachmentUrl()).set('Authorization',bearer(actors.author)).query({storageKey:'forged'}).expect(400);
    await request(app).post(attachmentUrl()).set('Authorization',bearer(actors.author)).query({uploadedById:actors.owner.id}).attach('file',txt,'x.txt').expect(400);
  });
});
