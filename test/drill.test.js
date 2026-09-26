import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import {
  validateSequence,
  validateInjections,
  evaluateRun
} from '../src/drill.js';

const product = await fixture('pilot-vn-typhoon-flood.json');
const agenciesDoc = await fixture('agencies.json');
const drills = await fixture('drills.json');
const vn = agenciesDoc.agencies.find((a) => a.country_code === 'VN');
const script = drills.scripts[0];

test('脚本台风相位顺序合法：形成→逼近→登陆→洪涝→灾后', () => {
  const r = validateSequence(script);
  assert.equal(r.valid, true);
});

test('登陆排在逼近之前的脚本被判定为乱序', () => {
  const bad = {
    ...script,
    event_sequence: [
      { seq: 1, phase: 'formation', offset_hours: 0 },
      { seq: 2, phase: 'landfall', offset_hours: 24 },
      { seq: 3, phase: 'approach', offset_hours: 40 }
    ]
  };
  const r = validateSequence(bad);
  assert.equal(r.valid, false);
  assert.ok(r.problems.some((p) => p.includes('相位顺序错误')));
});

test('时间偏移倒退同样被拦截', () => {
  const bad = {
    ...script,
    event_sequence: [
      { seq: 1, phase: 'formation', offset_hours: 24 },
      { seq: 2, phase: 'approach', offset_hours: 10 }
    ]
  };
  assert.equal(validateSequence(bad).valid, false);
});

test('注入点必须引用脚本中存在的 seq', () => {
  assert.equal(validateInjections(script).valid, true);
  const bad = {
    ...script,
    injections: [{ at_seq: 99, kind: 'network_outage', detail: 'x' }]
  };
  assert.equal(validateInjections(bad).valid, false);
});

test('9月8日演练：三类注入全部接管、跨境合规，评估合格', () => {
  const run = drills.runs.find((r) => r.run_id === 'run-vn-2026-09-08');
  const r = evaluateRun(product, vn, script, run);
  assert.equal(r.valid, true);
  assert.equal(r.observed_mode, 'manual');
  assert.equal(r.takeover_closed, true);
  // 演练中必须实际演示过移交/升级，证明人工流程真的接得住。
  assert.equal(r.shutdown_demonstrated, true);
  assert.equal(r.cross_border_ok, true);
});

test('8月25日演练：网络降级无接管记录且夹带原始数据，评估不合格', () => {
  const run = drills.runs.find((r) => r.run_id === 'run-vn-2026-08-25');
  const r = evaluateRun(product, vn, script, run);
  assert.equal(r.valid, false);
  assert.ok(r.fail_reasons.some((f) => f.includes('network_outage缺接管')));
  assert.ok(r.fail_reasons.some((f) => f.includes('raw_station_data')));
});
