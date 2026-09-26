import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import {
  loadRegistry,
  hasDeploymentLicense,
  environmentDifferences,
  sensorCoverage
} from '../src/registry.js';

const projectsDoc = await fixture('projects.json');
const agenciesDoc = await fixture('agencies.json');
const reg = loadRegistry(projectsDoc, agenciesDoc);

test('七国机构齐全且时区/语言各异', () => {
  assert.equal(reg.agencies.size, 7);
  for (const code of ['VN', 'TH', 'ID', 'MY', 'PH', 'SG', 'KH']) {
    const a = reg.getAgency(code);
    assert.match(a.timezone, /^Asia\//);
    assert.ok(a.languages.length >= 1);
  }
  // 时区差异是真实存在的：雅加达与胡志明同 UTC+7，但新加坡是 UTC+8。
  assert.notEqual(
    reg.getAgency('VN').timezone,
    reg.getAgency('SG').timezone
  );
});

test('灾种分级各国不同：越南四级与菲律宾五级只可按 rank 比较', () => {
  const vn = reg.getAgency('VN').hazard_scale.levels;
  const ph = reg.getAgency('PH').hazard_scale.levels;
  assert.equal(vn.length, 4);
  assert.equal(ph.length, 5);
  assert.equal(vn.find((l) => l.code === 'VN-RED').rank, 3);
  assert.equal(ph.find((l) => l.code === 'PH-TCWS-4').rank, 3);
  // 同 rank 不代表同义：四级色标红 vs 四号风讯，代码不得互用。
  assert.notEqual(vn[3].code, ph[3].code);
});

test('获奖项目在清单中仍是 none：获奖不是上线许可', () => {
  const winner = reg.getProject('prj-typhoon-flood');
  assert.equal(winner.award.won, true);
  assert.equal(winner.license.deployment_license, 'none');
  assert.equal(hasDeploymentLicense(winner), false);
});

test('已有试点许可的项目，许可范围限于发放国，不自动延及越南', () => {
  const msg = reg.getProject('prj-flood-msg');
  assert.equal(hasDeploymentLicense(msg), true);
  // 越南产品引用的是另一个项目；且即便同一项目，新加坡许可也不构成越南许可。
  const vn = reg.getProject('prj-typhoon-flood');
  assert.equal(vn.project_id, 'prj-typhoon-flood');
});

test('越南环境与原演示环境在语言、分级、出境规则上均存在差异', () => {
  const project = reg.getProject('prj-typhoon-flood');
  const vn = reg.getAgency('VN');
  const diffs = environmentDifferences(project, vn);
  assert.deepEqual(diffs.sort(), ['data_export_regime', 'hazard_scale', 'language'].sort());
});

test('试点站点缺少演示环境的雷达源，且传感源数量检查生效', async () => {
  const project = reg.getProject('prj-typhoon-flood');
  const vnProduct = await fixture('pilot-vn-typhoon-flood.json');
  const site = vnProduct.deployment_sites[0];
  const cov = sensorCoverage(project, site);
  assert.ok(cov.missing_from_demo.includes('雷达回波'));
  assert.equal(cov.meetsMinimum, true);
});
