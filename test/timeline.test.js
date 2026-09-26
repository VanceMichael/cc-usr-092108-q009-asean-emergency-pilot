import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import {
  sortedEvents,
  typhoonChain,
  withdrawnCountries,
  canScaleUp,
  scaleUpVerdict
} from '../src/timeline.js';

const timeline = await fixture('events.json');
const events = timeline.events;

test('事件按 UTC 排序，本地时间展示不影响先后', () => {
  const sorted = sortedEvents(events);
  // 8月25日失败演练在时间线文件中排在9月事件之后，排序后应位于最前。
  assert.equal(sorted[0].event_id, 'evt-drill-run-fail');
  const ids = sorted.map((e) => e.event_id);
  assert.ok(ids.indexOf('evt-vn-signoff') < ids.indexOf('evt-typhoon-landfall'));
});

test('台风事件链：形成→逼近→登陆→洪涝顺序正确', () => {
  const chain = typhoonChain(events, 'pilot-vn-typhoon-flood');
  assert.equal(chain.valid, true);
  const phases = chain.ordered.map((s) => s.phase);
  assert.deepEqual(phases, ['formation', 'approach', 'landfall', 'flood']);
});

test('台风相位倒退被检测', () => {
  const bad = [
    { event_id: 'a', at_utc: '2026-09-14T18:00:00Z', kind: 'typhoon_phase', country_scope: ['VN'], product_id: 'p', phase: 'formation', detail: '台风形成' },
    { event_id: 'b', at_utc: '2026-09-15T18:00:00Z', kind: 'typhoon_phase', country_scope: ['VN'], product_id: 'p', phase: 'landfall', detail: '登陆被误记在逼近之前' },
    { event_id: 'c', at_utc: '2026-09-16T18:00:00Z', kind: 'typhoon_phase', country_scope: ['VN'], product_id: 'p', phase: 'approach', detail: '逼近阶段' }
  ];
  const r = typhoonChain(bad, 'p');
  assert.equal(r.valid, false);
  assert.ok(r.problems[0].includes('相位倒退'));
});

test('印尼撤回即时生效：决策时印尼已在冻结集合中', () => {
  const frozen = withdrawnCountries(events, '2026-09-20T06:00:00Z');
  assert.ok(frozen.has('ID'));
  assert.ok(!frozen.has('VN'));
});

test('扩大推广：越南凭合格演练获准，印尼因撤回被冻结', () => {
  const vn = canScaleUp(events, 'VN', 'evt-scaleup-proposed');
  assert.equal(vn.allowed, true);
  assert.deepEqual(vn.reasons, []);

  const id = canScaleUp(events, 'ID', 'evt-scaleup-proposed');
  assert.equal(id.allowed, false);
  assert.ok(id.reasons.some((r) => r.includes('撤回')));
});

test('资金里程碑已拨付也不抵消证据/撤回缺失', () => {
  const id = canScaleUp(events, 'ID', 'evt-scaleup-proposed');
  assert.equal(id.funded, true);
  assert.equal(id.allowed, false);
});

test('同一决策事件逐国结论独立', () => {
  const verdicts = scaleUpVerdict(events, 'evt-scaleup-proposed');
  const byCountry = Object.fromEntries(verdicts.map((v) => [v.country, v.allowed]));
  assert.deepEqual(byCountry, { VN: true, ID: false });
});

test('撤回生效前一刻的决策不会被未来撤回追溯冻结', () => {
  const decision = {
    event_id: 'evt-early-decision',
    at_utc: '2026-09-16T00:00:00Z',
    kind: 'scale_up_decision',
    country_scope: ['ID'],
    detail: '撤回前的评审点'
  };
  const withEarly = [...events, decision];
  const r = canScaleUp(withEarly, 'ID', 'evt-early-decision');
  // 撤回尚未发生，但当时也没有合格演练证据 → 仍不允许，只是理由不含撤回。
  assert.equal(r.allowed, false);
  assert.ok(!r.reasons.some((x) => x.includes('撤回')));
});
