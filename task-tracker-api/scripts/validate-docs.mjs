import SwaggerParser from '@apidevtools/swagger-parser';
import { parseDocument } from 'yaml';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const spec = await SwaggerParser.validate('docs/openapi.json', { resolve: { external: false } });
const operations = Object.values(spec.paths).reduce((count, item) => count
  + Object.keys(item).filter((method) => ['get','post','patch','delete'].includes(method)).length, 0);
assert.equal(operations, 38, 'Review the endpoint inventory when API operations change');
const workflowPath = process.argv[2] || '../.github/workflows/task-tracker-ci.yml';
const document = parseDocument(readFileSync(workflowPath, 'utf8'), { uniqueKeys: true });
assert.equal(document.errors.length, 0, 'CI YAML must parse without errors');
const workflow = document.toJS();
assert.deepEqual(workflow.on.push.paths, ['task-tracker-api/**', '.github/workflows/task-tracker-ci.yml']);
assert.deepEqual(workflow.on.pull_request.paths, workflow.on.push.paths);
assert.equal(workflow.permissions.contents, 'read');
const job = workflow.jobs.verify;
assert.equal(job.defaults.run['working-directory'], 'task-tracker-api');
assert.equal(job.services.postgres.env.POSTGRES_DB.endsWith('_test'), true);
assert.equal(new URL(job.env.TEST_DATABASE_URL).pathname === new URL(job.env.DATABASE_URL).pathname, false);
assert.equal(job.steps.find((step) => step.uses?.startsWith('actions/setup-node@')).with['node-version'], '22.13.0');
for (const command of ['npm ci', 'npm run prisma:generate', 'npm run test:db:migrate', 'npm run typecheck', 'npm run build', 'npm test', 'npm run test:runtime']) {
  assert.ok(job.steps.some((step) => step.run === command), `Missing CI step: ${command}`);
}
console.log(`Validated OpenAPI (${operations} operations) and CI YAML/monorepo structure. Hosted Actions execution is a separate check.`);
