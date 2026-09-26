// 并发事件时间线：多方签署、并行部署、时区差异、台风相位、资金里程碑、撤回
// 可能同时发生。全部先后判断只用 at_utc；local_time_context 仅供展示。
// 每个国家独立掌握本地风险与处置：一国撤回不影响另一国运行。

function t(event) {
  const ms = Date.parse(event.at_utc);
  if (Number.isNaN(ms)) throw new Error(`事件 ${event.event_id} 的 at_utc 无法解析`);
  return ms;
}

// 稳定排序：同刻事件按 event_id 排序，保证多方同时签署时结果可复现。
export function sortedEvents(events) {
  return [...events].sort((a, b) => t(a) - t(b) || a.event_id.localeCompare(b.event_id));
}

const TYPHOON_PHASES = ['formation', 'approach', 'landfall', 'flood', 'post_event'];

// 台风事件链必须按形成→逼近→登陆→洪涝→灾后推进（允许省略阶段，不允许倒退）。
export function typhoonChain(events, productId) {
  const chain = sortedEvents(
    events.filter((e) => e.kind === 'typhoon_phase' && e.product_id === productId)
  );
  const problems = [];
  let seen = -1;
  for (const e of chain) {
    const idx = TYPHOON_PHASES.indexOf(e.phase);
    if (idx >= 0) {
      if (idx < seen) {
        problems.push(`台风相位倒退：${e.event_id}（${e.phase} 排在已出现的更后相位之后）`);
      }
      seen = Math.max(seen, idx);
    }
  }
  return {
    valid: problems.length === 0,
    problems,
    ordered: chain.map((e) => ({ event_id: e.event_id, phase: e.phase, at_utc: e.at_utc }))
  };
}

// 截至某时刻，已撤回成果的国家集合；撤回即时生效。
export function withdrawnCountries(events, atUtc) {
  const cutoff = Date.parse(atUtc);
  const frozen = new Set();
  for (const e of events) {
    if (e.kind === 'withdrawal' && t(e) <= cutoff) {
      for (const c of e.country_scope) frozen.add(c);
    }
  }
  return frozen;
}

// 扩大推广判定。主办方只能依据真实演练与运行证据：
//  - 该国在决策时刻未撤回；
//  - 决策前存在该国范围、合格演练的证据事件；
//  - 资金里程碑不构成授权，主办方提议也不构成授权；
//  - 撤回的国家范围被直接冻结，其他国家独立评审。
export function canScaleUp(events, country, decisionEventId) {
  const decision = events.find((e) => e.event_id === decisionEventId);
  if (!decision) throw new Error(`未找到决策事件：${decisionEventId}`);
  if (decision.kind !== 'scale_up_decision') {
    throw new Error(`${decisionEventId} 不是扩大推广决策事件`);
  }
  if (!decision.country_scope.includes(country)) {
    return { decision: decisionEventId, country, allowed: false, reasons: ['决策范围不含该国'] };
  }

  const reasons = [];
  const frozen = withdrawnCountries(events, decision.at_utc);
  if (frozen.has(country)) reasons.push('该国已撤回成果，扩大推广即时冻结');

  const prior = events.filter((e) => t(e) < t(decision));
  const passedDrill = prior.some(
    (e) => e.kind === 'drill_run' &&
      e.country_scope.includes(country) &&
      (e.evidence_refs ?? []).length > 0 &&
      /合格|passed/i.test(e.detail ?? '')
  );
  if (!passedDrill) reasons.push('缺少决策前的合格真实演练证据');

  // 资金里程碑即使已拨付（含 ASEAN 范围的统筹拨付），也不抵消证据缺失。
  const funded = prior.some(
    (e) => e.kind === 'funding_milestone' &&
      (e.country_scope.includes(country) || e.country_scope.includes('ASEAN'))
  );

  return {
    decision: decisionEventId,
    country,
    allowed: reasons.length === 0,
    funded,
    reasons
  };
}

// 时间线全景：逐国给出扩大推广结论，便于展示"同一次多方决策、各国命运独立"。
export function scaleUpVerdict(events, decisionEventId) {
  const decision = events.find((e) => e.event_id === decisionEventId);
  return decision.country_scope
    .filter((c) => c !== 'ASEAN')
    .map((country) => canScaleUp(events, country, decisionEventId));
}
