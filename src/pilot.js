// 试点产品准入：本地化评审、数据授权、人员培训、回退方案四项闸门。
// 缺任何一项（未通过或缺少证据）都不得进入真实值守。

const GATE_KEYS = [
  ['localization_review', '本地化评审'],
  ['data_authorization', '数据授权'],
  ['personnel_training', '人员培训'],
  ['rollback_plan', '回退方案']
];

const COMPONENT_KEYS = [
  'technical_capability',
  'training_data_boundary',
  'device_dependency',
  'deployment_site',
  'responsible_agency',
  'drill_script',
  'acceptance_criteria'
];

const SEMVER = /^v\d+\.\d+\.\d+$/;

// 七类组件必须各自带独立语义版本；组件级版本互不联动。
export function componentVersions(product) {
  const out = {};
  for (const key of COMPONENT_KEYS) {
    const c = product.components?.[key];
    if (!c || !SEMVER.test(c.component_version)) {
      throw new Error(`组件缺少合法版本号：${key}`);
    }
    out[key] = c.component_version;
  }
  return out;
}

// 返回每项闸门的状态；闸门通过必须同时满足 passed=true 且有证据和评审人。
export function admissionStatus(product) {
  const result = {};
  for (const [key, label] of GATE_KEYS) {
    const gate = product.admission?.[key];
    const satisfied = Boolean(
      gate && gate.passed === true &&
      typeof gate.evidence_ref === 'string' && gate.evidence_ref.length > 0 &&
      typeof gate.reviewer === 'string' && gate.reviewer.length > 0
    );
    result[key] = { label, satisfied, reason: satisfied ? null : missingReason(gate) };
  }
  return result;
}

function missingReason(gate) {
  if (!gate) return '闸门未登记';
  if (gate.passed !== true) return '评审未通过';
  if (!gate.evidence_ref) return '缺少证据编号';
  if (!gate.reviewer) return '缺少评审责任机构';
  return null;
}

export function missingGates(product) {
  return Object.entries(admissionStatus(product))
    .filter(([, v]) => !v.satisfied)
    .map(([k, v]) => ({ gate: k, label: v.label, reason: v.reason }));
}

// 唯一的真实值守入口判定：四项闸门全满足。
// 获奖状态、资金拨付、主办方意向均不在此函数中出现——它们不构成许可。
export function canEnterLiveWatch(product) {
  const missing = missingGates(product);
  return { allowed: missing.length === 0, missing };
}

// 状态声明必须与闸门事实一致：声明 live_watch 但闸门不齐属于资料矛盾，必须拦截。
export function statusConsistency(product) {
  const { allowed } = canEnterLiveWatch(product);
  const phase = product.status?.phase;
  const problems = [];
  if (phase === 'live_watch' && !allowed) {
    problems.push('状态声明为真实值守，但准入闸门未齐');
  }
  if (phase === 'admission_pending' && allowed) {
    problems.push('准入闸门已齐，但状态仍停留在准入待定');
  }
  return { consistent: problems.length === 0, problems };
}
