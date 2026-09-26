import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import {
  resolveMode,
  confidenceTriggers,
  evaluateDegradation,
  validateTakeoverRecords,
  modeRank
} from '../src/degradation.js';

const vn = await fixture('pilot-vn-typhoon-flood.json');
const policy = vn.degradation_policy;

test('无触发时保持全自动模式', () => {
  assert.equal(resolveMode(policy, []), 'autonomous');
});

test('网络中断降级为仅建议，系统不得自动对外发预警', () => {
  const [network] = policy.triggers.filter((t) => t.kind === 'network_outage');
  const mode = resolveMode(policy, [network]);
  assert.equal(mode, 'advisory_only');
  const def = policy.modes.find((m) => m.mode === mode);
  assert.equal(def.system_may_emit_alert, false);
});

test('置信度0.58同时命中两条阈值，取最严 manual', () => {
  const fired = confidenceTriggers(policy, 0.58);
  assert.equal(fired.length, 2);
  assert.equal(resolveMode(policy, fired), 'manual');
});

test('多重触发并存（漂移assisted + 低置信manual）取最严模式', () => {
  const drift = policy.triggers.find((t) => t.kind === 'sensor_drift');
  const lowConf = confidenceTriggers(policy, 0.55);
  assert.equal(resolveMode(policy, [drift, ...lowConf]), 'manual');
  assert.equal(modeRank(policy, 'manual'), 3);
});

test('降级但无接管记录：接管不闭环', () => {
  const [network] = policy.triggers.filter((t) => t.kind === 'network_outage');
  const result = evaluateDegradation(policy, [network], []);
  assert.equal(result.mode, 'advisory_only');
  assert.equal(result.needsTakeover, true);
  assert.equal(result.takeoverClosed, false);
  assert.deepEqual(result.coverage.missing[0], {
    trigger_kind: 'network_outage',
    required_mode: 'advisory_only'
  });
});

test('接管记录缺必填字段（无 resolution）判定为无效留痕', () => {
  const records = [
    {
      trigger_kind: 'network_outage',
      from_mode: 'autonomous',
      to_mode: 'advisory_only',
      operator: '某值守员',
      began_at_utc: '2026-09-16T14:02:00Z'
      // 缺 resolution
    }
  ];
  const check = validateTakeoverRecords(policy, records);
  assert.equal(check.valid, false);
  assert.match(check.problems[0], /resolution/);
});

test('降级与接管记录一一对应时闭环', () => {
  const [network] = policy.triggers.filter((t) => t.kind === 'network_outage');
  const records = [
    {
      trigger_kind: 'network_outage',
      from_mode: 'autonomous',
      to_mode: 'advisory_only',
      operator: '某值守员',
      began_at_utc: '2026-09-16T14:02:00Z',
      resolution: 'restored'
    }
  ];
  const result = evaluateDegradation(policy, [network], records);
  assert.equal(result.takeoverClosed, true);
});
