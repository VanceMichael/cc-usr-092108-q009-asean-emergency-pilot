// 演练评估：脚本台风相位顺序、注入→降级→接管的闭环、跨境输出合规。
// 主办方只能依据真实演练（和后续运行证据）决定扩大推广，因此演练评估是
// 扩证决策的唯一输入之一。

import { evaluateDegradation } from './degradation.js';

const PHASE_ORDER = ['formation', 'approach', 'landfall', 'flood', 'post_event'];

// 校验脚本的台风事件顺序：seq 与 offset_hours 都必须严格递增，
// 且相位符合 formation→approach→landfall→flood→post_event。
export function validateSequence(script) {
  const problems = [];
  const steps = [...script.event_sequence].sort((a, b) => a.seq - b.seq);
  let prev = null;
  for (const step of steps) {
    if (prev) {
      if (step.offset_hours <= prev.offset_hours) {
        problems.push(`时间偏移未递增：${prev.phase}(${prev.offset_hours}h) → ${step.phase}(${step.offset_hours}h)`);
      }
      const pi = PHASE_ORDER.indexOf(prev.phase);
      const ci = PHASE_ORDER.indexOf(step.phase);
      if (ci <= pi) problems.push(`相位顺序错误：${prev.phase} 之后不可为 ${step.phase}`);
    }
    prev = step;
  }
  return { valid: problems.length === 0, problems };
}

// 注入点必须落在脚本已有的 seq 上。
export function validateInjections(script) {
  const seqs = new Set(script.event_sequence.map((s) => s.seq));
  const problems = script.injections
    .filter((i) => !seqs.has(i.at_seq))
    .map((i) => `注入点 ${i.at_seq} 不在脚本序列中`);
  return { valid: problems.length === 0, problems };
}

// 从脚本注入重建当时应触发的策略条目。
// 同一注入类型取策略中该类最严的已登记触发（演练设计意图：注入即触发）。
export function firedTriggersFromInjections(product, injections) {
  const byKind = {};
  for (const t of product.degradation_policy.triggers) {
    (byKind[t.kind] ??= []).push(t);
  }
  const rank = (mode) =>
    product.degradation_policy.modes.find((x) => x.mode === mode).rank;
  const fired = [];
  for (const inj of injections) {
    const candidates = byKind[inj.kind];
    if (!candidates) throw new Error(`降级策略缺少触发类型：${inj.kind}`);
    const pick = candidates.reduce((a, b) => (rank(b.to_mode) > rank(a.to_mode) ? b : a));
    fired.push(pick);
  }
  return fired;
}

// 单次演练运行的完整评估，结果可直接作为扩大推广证据链的一环。
export function evaluateRun(product, agency, script, run) {
  const seq = validateSequence(script);
  const inj = validateInjections(script);
  const fired = firedTriggersFromInjections(product, script.injections);
  const deg = evaluateDegradation(product.degradation_policy, fired, run.takeover_records);

  const rankOf = (mode) =>
    product.degradation_policy.modes.find((m) => m.mode === mode).rank;
  const modeOK = rankOf(run.observed_mode) >= rankOf(script.expected.min_mode);
  const records = run.takeover_records ?? [];
  const shutdown = records.some((r) => ['handed_over', 'escalated'].includes(r.resolution));

  // 跨境输出逐份检查，必须全部只含该国白名单字段。
  const outputs = (run.cross_border_outputs ?? []).map((o) => ({
    fields: o.fields,
    bad: o.fields.filter((f) => !agency.data_export.allowed_outbound_fields.includes(f))
  }));
  const crossBorderOK = outputs.every((o) => o.bad.length === 0);

  const failReasons = [];
  if (!seq.valid) failReasons.push(...seq.problems);
  if (!inj.valid) failReasons.push(...inj.problems);
  if (!modeOK) failReasons.push('实际模式宽于脚本期望的最严模式');
  if (script.expected.takeover_required && !deg.takeoverClosed) {
    failReasons.push('人工接管未闭环：' +
      [...deg.coverage.missing.map((m) => `${m.trigger_kind}缺接管`), ...deg.recordProblems].join('；'));
  }
  if (!crossBorderOK) {
    failReasons.push('跨境输出违规：' + outputs.flatMap((o) => o.bad).join('、'));
  }

  return {
    run_id: run.run_id,
    valid: failReasons.length === 0,
    sequence_valid: seq.valid,
    observed_mode: run.observed_mode,
    takeover_closed: deg.takeoverClosed,
    shutdown_demonstrated: shutdown,
    cross_border_ok: crossBorderOK,
    fail_reasons: failReasons
  };
}
