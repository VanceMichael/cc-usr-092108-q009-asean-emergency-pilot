import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import {
  componentVersions,
  admissionStatus,
  missingGates,
  canEnterLiveWatch,
  statusConsistency
} from '../src/pilot.js';

const vn = await fixture('pilot-vn-typhoon-flood.json');
const th = await fixture('pilot-th-typhoon-flood.json');

test('七类组件各自带独立语义版本', () => {
  const versions = componentVersions(vn);
  assert.deepEqual(Object.keys(versions).sort(), [
    'acceptance_criteria',
    'deployment_site',
    'device_dependency',
    'drill_script',
    'responsible_agency',
    'technical_capability',
    'training_data_boundary'
  ]);
  // 部署地点组件已到 v2，演练脚本 v1.1，其他仍 v1 —— 版本互不联动。
  assert.equal(versions.deployment_site, 'v2.0.0');
  assert.equal(versions.drill_script, 'v1.1.0');
  assert.equal(versions.training_data_boundary, 'v1.0.0');
});

test('越南试点四项准入齐备，可进入真实值守', () => {
  const status = admissionStatus(vn);
  for (const [, v] of Object.entries(status)) assert.equal(v.satisfied, true);
  const gate = canEnterLiveWatch(vn);
  assert.equal(gate.allowed, true);
  assert.deepEqual(gate.missing, []);
});

test('泰国试点数据授权未过：缺一项即禁止真实值守', () => {
  const gate = canEnterLiveWatch(th);
  assert.equal(gate.allowed, false);
  assert.deepEqual(gate.missing.map((m) => m.gate), ['data_authorization']);
  assert.match(gate.missing[0].reason, /未通过/);
});

test('声明的值守状态必须与准入事实一致', () => {
  assert.equal(statusConsistency(vn).consistent, true);
  assert.equal(statusConsistency(th).consistent, true);
  const liar = {
    ...th,
    status: { phase: 'live_watch', note: '伪造值守状态' }
  };
  const check = statusConsistency(liar);
  assert.equal(check.consistent, false);
  assert.match(check.problems[0], /准入闸门未齐/);
});

test('任何准入闸门缺少证据编号都不算通过', () => {
  const broken = {
    ...vn,
    admission: {
      ...vn.admission,
      rollback_plan: { ...vn.admission.rollback_plan, evidence_ref: '' }
    }
  };
  const gate = canEnterLiveWatch(broken);
  assert.equal(gate.allowed, false);
  assert.deepEqual(gate.missing[0].gate, 'rollback_plan');
  assert.match(gate.missing[0].reason, /证据/);
});
