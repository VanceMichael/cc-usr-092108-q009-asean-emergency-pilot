// 自动降级策略：网络中断、传感器漂移、置信度下降。
// 多重触发同时存在时取最严（rank 最大）模式；只要离开全自动模式，
// 就必须留下与触发相对应的人工接管记录——只降级不留痕视为失效。

const MODE_ORDER = ['autonomous', 'assisted', 'advisory_only', 'manual'];

export function modeRank(policy, mode) {
  const found = policy.modes.find((m) => m.mode === mode);
  if (!found) throw new Error(`未登记的运行模式：${mode}`);
  return found.rank;
}

// firedTriggers：已实际触发的策略条目（policy.triggers 中条件被满足的那些）。
export function resolveMode(policy, firedTriggers) {
  if (!firedTriggers.length) return 'autonomous';
  let strictest = 'autonomous';
  for (const t of firedTriggers) {
    if (!MODE_ORDER.includes(t.to_mode)) {
      throw new Error(`触发 ${t.kind} 指向未登记模式：${t.to_mode}`);
    }
    if (modeRank(policy, t.to_mode) > modeRank(policy, strictest)) {
      strictest = t.to_mode;
    }
  }
  return strictest;
}

// 模拟现场信号：置信度数值映射到被触发的策略条目。
export function confidenceTriggers(policy, confidence) {
  return policy.triggers.filter(
    (t) => t.kind === 'confidence_drop' &&
      confidence < thresholdNumber(t.threshold)
  );
}

function thresholdNumber(text) {
  const m = text.match(/([0-9.]+)/);
  if (!m) throw new Error(`无法解析阈值：${text}`);
  return Number(m[1]);
}

// 每条导致降级的触发都必须有接管记录兜底：
// 记录的触发类型要匹配，且实际到达模式不得宽于该触发要求的模式。
export function takeoverCoverage(policy, firedTriggers, records) {
  const degrading = firedTriggers.filter((t) => modeRank(policy, t.to_mode) > 0);
  const missing = [];
  for (const t of degrading) {
    const covered = records.some(
      (r) => r.trigger_kind === t.kind &&
        modeRank(policy, r.to_mode) >= modeRank(policy, t.to_mode)
    );
    if (!covered) {
      missing.push({ trigger_kind: t.kind, required_mode: t.to_mode });
    }
  }
  return { complete: missing.length === 0, missing };
}

// 接管记录必须包含策略声明的必填字段，且操作人、开始时间不可为空。
export function validateTakeoverRecords(policy, records) {
  const required = policy.takeover_record_fields ?? [];
  const problems = [];
  records.forEach((r, i) => {
    for (const field of required) {
      const v = r[field];
      if (v === undefined || v === null || v === '') {
        problems.push(`第${i + 1}条接管记录缺少字段 ${field}`);
      }
    }
  });
  return { valid: problems.length === 0, problems };
}

// 一次降级事件的完整评估：系统应处模式 + 人工接管是否闭环。
export function evaluateDegradation(policy, firedTriggers, records) {
  const mode = resolveMode(policy, firedTriggers);
  const coverage = takeoverCoverage(policy, firedTriggers, records);
  const fields = validateTakeoverRecords(policy, records);
  const needsTakeover = modeRank(policy, mode) > 0;
  return {
    mode,
    needsTakeover,
    takeoverClosed: !needsTakeover || (coverage.complete && fields.valid),
    coverage,
    recordProblems: fields.problems
  };
}
