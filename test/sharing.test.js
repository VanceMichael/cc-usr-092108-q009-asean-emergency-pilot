import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { sanitizeForExport, toSeverityRank } from '../src/sharing.js';

const agenciesDoc = await fixture('agencies.json');
const vn = agenciesDoc.agencies.find((a) => a.country_code === 'VN');
const th = agenciesDoc.agencies.find((a) => a.country_code === 'TH');
const product = await fixture('pilot-vn-typhoon-flood.json');

const cleanSummary = {
  summary_id: 'sum-2026-0916-01',
  hazard_type: 'flood',
  severity_rank: 3,
  area_label: 'Quang Binh（虚构）',
  issued_at_utc: '2026-09-16T20:30:00Z',
  advice_text: 'Hãy di tản ngay（虚构越南语疏散建议）',
  source_agency: '越南灾害应对协调局（虚构）'
};

test('获准摘要可出境：七项白名单字段全部保留', () => {
  const r = sanitizeForExport(vn, product, cleanSummary, true);
  assert.equal(r.allowed, true);
  assert.deepEqual(Object.keys(r.summary).sort(), Object.keys(cleanSummary).sort());
});

test('未获数据授权：整份载荷禁止出境', () => {
  const r = sanitizeForExport(vn, product, cleanSummary, false);
  assert.equal(r.allowed, false);
  assert.match(r.violations[0], /授权/);
});

test('夹带原始站点数据被拦截', () => {
  const r = sanitizeForExport(vn, product, { ...cleanSummary, raw_station_data: {} }, true);
  assert.equal(r.allowed, false);
  assert.ok(r.violations.some((v) => v.includes('raw_station_data')));
});

test('越南允许的 advice_text 到了泰国白名单外：按各国规则独立过滤', () => {
  const r = sanitizeForExport(th, product, cleanSummary, true);
  assert.equal(r.allowed, false);
  assert.ok(r.violations.some((v) => v.includes('advice_text')));
  assert.ok(r.violations.some((v) => v.includes('area_label')));
});

test('本地等级代码转跨国严重度：只共享 rank 不共享代码', () => {
  assert.equal(toSeverityRank(vn, 'VN-RED'), 3);
  assert.equal(toSeverityRank(th, 'TH-T4'), 3);
  assert.throws(() => toSeverityRank(vn, 'TH-T4'), /未登记/);
});
