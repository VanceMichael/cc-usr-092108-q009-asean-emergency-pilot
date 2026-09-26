import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

// 契约（JSON Schema）是产品的对外格式承诺；样例必须始终满足契约。
const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats').default;
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);

async function load(name) {
  return JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), 'utf8'));
}

const pairs = [
  ['contracts/context.schema.json', 'fixtures/context.json'],
  ['contracts/projects.schema.json', 'fixtures/projects.json'],
  ['contracts/agencies.schema.json', 'fixtures/agencies.json'],
  ['contracts/pilot-product.schema.json', 'fixtures/pilot-vn-typhoon-flood.json'],
  ['contracts/pilot-product.schema.json', 'fixtures/pilot-th-typhoon-flood.json'],
  ['contracts/drills.schema.json', 'fixtures/drills.json'],
  ['contracts/timeline.schema.json', 'fixtures/events.json']
];

for (const [schemaPath, fixturePath] of pairs) {
  test(`样例 ${fixturePath} 符合契约 ${schemaPath}`, async () => {
    const [schema, data] = await Promise.all([load(schemaPath), load(fixturePath)]);
    const validate = ajv.compile(schema);
    const ok = validate(data);
    assert.equal(ok, true, ok ? '' : ajv.errorsText(validate.errors));
  });
}
