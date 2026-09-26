// 读取并校验跨国台风洪涝试点产品资料。
// 设计原则：结构错误直接抛出；业务不变量错误收集后统一返回，便于逐条评审。

const FAMILIES = [
  'technical_capability',
  'training_data_boundary',
  'equipment_dependency',
  'deployment_site',
  'responsible_organization',
  'drill_script',
  'acceptance_metric',
];

const LEVEL_RANK = {
  L3_autonomous: 3,
  L2_assisted: 2,
  L1_advisory: 1,
  L0_manual_only: 0,
};

const PHASE_ORDER = {
  formation: 0,
  approach: 1,
  landfall: 2,
  flooding: 3,
  weakening: 4,
};

// 样例涉及的 IANA 时区固定偏移（均无夏令时）。
const TIMEZONE_OFFSET_HOURS = {
  'Asia/Ho_Chi_Minh': 7,
  'Asia/Manila': 8,
  'Asia/Bangkok': 7,
  'Asia/Jakarta': 7,
  'Asia/Kuala_Lumpur': 8,
  'Asia/Phnom_Penh': 7,
  'Asia/Vientiane': 7,
};

function t(utc) {
  return Date.parse(utc);
}

export function parsePilotProduct(raw) {
  const value = JSON.parse(raw);
  const required = [
    'product_id',
    'source_project',
    'artifacts',
    'organizations',
    'country_profiles',
    'deployments',
    'drills',
    'operations',
    'cross_border_sharing',
    'governance',
  ];
  for (const key of required) {
    if (value[key] === undefined || value[key] === null) {
      throw new Error(`试点产品资料缺少必要字段：${key}`);
    }
  }
  return value;
}

export function validateProduct(value) {
  const errors = [];
  const add = (msg) => errors.push(msg);

  // ---- 索引 ----
  const orgById = new Map(value.organizations.map((o) => [o.org_id, o]));
  const profileByCountry = new Map(value.country_profiles.map((p) => [p.country, p]));
  const depById = new Map(value.deployments.map((d) => [d.deployment_id, d]));
  const drillById = new Map(value.drills.map((d) => [d.drill_id, d]));
  const takeoverById = new Map(value.operations.manual_takeovers.map((r) => [r.record_id, r]));
  const degById = new Map(value.operations.degradation_events.map((e) => [e.event_id, e]));

  const versionIndex = new Map(); // family|version -> version 对象
  for (const family of FAMILIES) {
    const fam = value.artifacts[family];
    if (!fam || !Array.isArray(fam.versions) || !fam.versions.length) {
      add(`工件族 ${family} 缺少版本记录`);
      continue;
    }
    for (const v of fam.versions) {
      versionIndex.set(`${family}|${v.version}`, v);
    }
  }

  const resolveVersion = (ref, context) => {
    const v = versionIndex.get(`${ref.type}|${ref.version}`);
    if (!v) {
      add(`${context}：引用了不存在的工件版本 ${ref.type}@${ref.version}`);
      return null;
    }
    return v;
  };

  // ---- 七国机构 ----
  const orgCountries = new Set(value.organizations.map((o) => o.country));
  if (orgCountries.size < 7) {
    add(`机构资料至少覆盖 7 个国家，当前覆盖 ${orgCountries.size} 个`);
  }

  // ---- 获奖不是上线许可 ----
  if (value.source_project.award_is_operational_license !== false) {
    add('获奖结果被错误地标记为上线许可：award_is_operational_license 必须恒为 false');
  }

  // ---- 部署：钉版工件、闸门、责任机构 ----
  for (const dep of value.deployments) {
    const profile = profileByCountry.get(dep.country);
    if (!profile) {
      add(`部署 ${dep.deployment_id} 缺少国家本地化档案（${dep.country}）`);
    }

    const pinnedTypes = dep.pinned_artifacts.map((r) => r.type).sort();
    if (pinnedTypes.join(',') !== [...FAMILIES].sort().join(',')) {
      add(`部署 ${dep.deployment_id} 必须对七族工件各钉一个精确版本`);
    }
    for (const ref of dep.pinned_artifacts) {
      const v = resolveVersion(ref, `部署 ${dep.deployment_id}`);
      if (!v) continue;
      if (v.status !== 'issued') {
        add(`部署 ${dep.deployment_id} 钉用了${statusLabel(v.status)}工件 ${ref.type}@${ref.version}，只允许 issued 版本`);
      }
      if (!v.applies_to_countries.includes(dep.country)) {
        add(`部署 ${dep.deployment_id} 钉用的 ${ref.type}@${ref.version} 未声明适用于 ${dep.country}`);
      }
    }

    const gates = [
      ['localization_review', '本地化评审'],
      ['data_authorization', '数据授权'],
      ['personnel_training', '人员培训'],
      ['rollback_plan', '回退方案'],
    ];
    const failedGates = gates.filter(([k]) => dep.gates[k].passed !== true).map(([, label]) => label);

    if (dep.status === 'live_duty' && failedGates.length) {
      add(`部署 ${dep.deployment_id} 已进入真实值守，但闸门未全部通过：${failedGates.join('、')}`);
    }
    if (dep.status === 'blocked_pre_gate' && failedGates.length === 0) {
      add(`部署 ${dep.deployment_id} 标记为闸门拦截，却没有任何失败闸门，状态自相矛盾`);
    }

    if (profile) {
      if (dep.gates.localization_review.passed && profile.language.ui_approved !== true) {
        add(`部署 ${dep.deployment_id}：本地化评审已过，但 ${dep.country} 界面语言尚未获准`);
      }
      if (dep.gates.data_authorization.passed && profile.data_egress_rules.authorization_granted !== true) {
        add(`部署 ${dep.deployment_id}：数据授权闸门已过，但 ${dep.country} 数据出境/处理授权并未授予`);
      }
    }

    for (const orgId of dep.responsible_org_ids) {
      const org = orgById.get(orgId);
      if (!org) {
        add(`部署 ${dep.deployment_id} 引用了不存在的责任机构 ${orgId}`);
      } else if (org.country !== dep.country) {
        add(`部署 ${dep.deployment_id} 的责任机构 ${orgId} 不属于 ${dep.country}`);
      }
    }
  }

  // ---- 演练：事件顺序、时间窗、证据资格 ----
  for (const drill of value.drills) {
    const dep = depById.get(drill.deployment_id);
    if (!dep) {
      add(`演练 ${drill.drill_id} 引用了不存在的部署 ${drill.deployment_id}`);
      continue;
    }
    if (drill.is_real_event_evidence && drill.kind !== 'live_event') {
      add(`演练 ${drill.drill_id} 不是真实事件（kind=${drill.kind}），不得标记 is_real_event_evidence`);
    }
    if (drill.kind === 'live_event' && dep.status !== 'live_duty') {
      add(`演练 ${drill.drill_id}：非真实值守部署 ${dep.deployment_id} 不得产生真实事件值守证据`);
    }
    if (dep.status === 'blocked_pre_gate' && drill.kind !== 'tabletop') {
      add(`部署 ${dep.deployment_id} 仍被闸门拦截，演练 ${drill.drill_id} 只允许桌面推演，不得接触真实数据`);
    }

    const script = resolveVersion(drill.script_ref, `演练 ${drill.drill_id}`);
    if (script && script.status !== 'issued') {
      add(`演练 ${drill.drill_id} 引用了${statusLabel(script.status)}脚本 ${drill.script_ref.version}`);
    }
    for (const ref of drill.metric_refs) {
      const mv = resolveVersion(ref, `演练 ${drill.drill_id}`);
      if (mv && mv.status !== 'issued') {
        add(`演练 ${drill.drill_id} 引用了${statusLabel(mv.status)}验收指标 ${ref.version}`);
      }
    }

    let prev = null;
    drill.typhoon_sequence.forEach((step, i) => {
      const ctx = `演练 ${drill.drill_id} 台风序列第 ${i + 1} 步`;
      if (step.order !== i + 1) {
        add(`${ctx}：序号应为 ${i + 1}，实际为 ${step.order}`);
      }
      const at = t(step.utc_at);
      if (at < t(drill.started_at) || at > t(drill.concluded_at)) {
        add(`${ctx}：事件时间 ${step.utc_at} 落在演练时间窗之外`);
      }
      if (prev) {
        if (at <= prev.at) {
          add(`${ctx}：UTC 时间必须严格递增（${step.utc_at} 晚于前序事件）`);
        }
        if (PHASE_ORDER[step.phase] <= PHASE_ORDER[prev.phase]) {
          add(`${ctx}：阶段顺序错误，${step.phase} 不能出现在 ${prev.phase} 之后`);
        }
      }
      prev = { at, phase: step.phase };
    });

    for (const inj of drill.injects) {
      const at = t(inj.utc_at);
      if (at < t(drill.started_at) || at > t(drill.concluded_at)) {
        add(`演练 ${drill.drill_id} 注入 ${inj.inject_id} 落在演练时间窗之外`);
      }
    }
    // 真实事件值守：每个注入必须与同部署、同时间、同触发因、同目标等级的自动降级事件对应。
    if (drill.kind === 'live_event') {
      for (const inj of drill.injects) {
        const matched = value.operations.degradation_events.some(
          (e) =>
            e.deployment_id === drill.deployment_id &&
            e.trigger === inj.kind &&
            e.utc_at === inj.utc_at &&
            e.automated === true &&
            e.to_level === inj.expected_auto_degradation_level,
        );
        if (!matched) {
          add(`演练 ${drill.drill_id} 注入 ${inj.inject_id} 缺少对应的实际自动降级事件（${inj.kind} @ ${inj.utc_at} → ${inj.expected_auto_degradation_level}）`);
        }
      }
    }
    if (t(drill.concluded_at) <= t(drill.started_at)) {
      add(`演练 ${drill.drill_id} 结束时间必须晚于开始时间`);
    }
  }

  // ---- 运行：自动降级只能降档，L0 必须有人工接管记录 ----
  for (const dep of value.deployments) {
    const events = value.operations.degradation_events
      .filter((e) => e.deployment_id === dep.deployment_id)
      .sort((a, b) => t(a.utc_at) - t(b.utc_at));
    let prevAt = null;
    for (const e of events) {
      if (prevAt !== null && t(e.utc_at) < prevAt) {
        add(`降级事件 ${e.event_id} 时间早于同部署前序事件`);
      }
      prevAt = t(e.utc_at);

      const from = LEVEL_RANK[e.from_level];
      const to = LEVEL_RANK[e.to_level];
      if (e.trigger === 'recovery') {
        if (to <= from) add(`恢复事件 ${e.event_id} 必须回到更高自动化等级`);
      } else {
        if (e.automated !== true) {
          add(`降级事件 ${e.event_id} 由 ${e.trigger} 触发，必须是自动降级（automated=true）`);
        }
        if (to >= from) {
          add(`降级事件 ${e.event_id} 方向错误：${e.from_level} → ${e.to_level}，故障触发只能降档`);
        }
      }
      if (e.to_level === 'L0_manual_only') {
        if (!e.takeover_record_id) {
          add(`降级事件 ${e.event_id} 进入 L0 仅人工模式，必须留下人工接管记录编号`);
        } else if (!takeoverById.has(e.takeover_record_id)) {
          add(`降级事件 ${e.event_id} 引用的人工接管记录 ${e.takeover_record_id} 不存在`);
        }
      }
    }
  }

  for (const tk of value.operations.manual_takeovers) {
    const dep = depById.get(tk.deployment_id);
    if (!dep) {
      add(`人工接管 ${tk.record_id} 引用了不存在的部署 ${tk.deployment_id}`);
      continue;
    }
    const org = orgById.get(tk.operator_org_id);
    if (!org) {
      add(`人工接管 ${tk.record_id} 的值班机构 ${tk.operator_org_id} 不存在`);
    } else if (!dep.responsible_org_ids.includes(org.org_id)) {
      add(`人工接管 ${tk.record_id}：${org.org_id} 不是部署 ${dep.deployment_id} 的责任机构`);
    }
    if (!tk.operator_certificate_id) {
      add(`人工接管 ${tk.record_id} 缺少值班员培训证书编号`);
    }
    if (t(tk.handback_utc_at) <= t(tk.utc_at)) {
      add(`人工接管 ${tk.record_id} 的交还时间必须晚于接管时间`);
    }
    const l0 = value.operations.degradation_events.find(
      (e) => e.takeover_record_id === tk.record_id && e.to_level === 'L0_manual_only',
    );
    if (l0 && t(tk.utc_at) < t(l0.utc_at)) {
      add(`人工接管 ${tk.record_id} 时间早于触发它的 L0 降级事件 ${l0.event_id}`);
    }
  }

  // ---- 跨境共享：只共享获准的预警摘要 ----
  const sharing = value.cross_border_sharing;
  if (sharing.policy.only_approved_alert_summary !== true) {
    add('跨境共享策略必须限定为 only_approved_alert_summary=true');
  }
  for (const item of sharing.shared_items) {
    const ctx = `跨境共享 ${item.share_id}`;
    if (item.category !== 'approved_alert_summary') {
      add(`${ctx}：只允许共享获准的预警摘要，出现类别 ${item.category}`);
    }
    if (item.authorized !== true) {
      add(`${ctx}：共享未经授权`);
    }
    const sender = profileByCountry.get(item.from_country);
    if (!sender) {
      add(`${ctx}：发送国 ${item.from_country} 无本地化档案`);
    } else if (
      !sender.data_egress_rules.authorization_granted ||
      !sender.data_egress_rules.allowed_categories.includes('approved_alert_summary')
    ) {
      add(`${ctx}：发送国 ${item.from_country} 未授权预警摘要出境`);
    }
  }

  // ---- 治理：签署时区一致、撤回级联、推广证据 ----
  const gov = value.governance;

  for (const sig of gov.signatures) {
    const org = orgById.get(sig.org_id);
    if (!org) {
      add(`签署 ${sig.signature_id} 的机构 ${sig.org_id} 不存在`);
      continue;
    }
    if (org.country !== sig.country) {
      add(`签署 ${sig.signature_id} 的国家与机构所属国不一致`);
    }
    const offset = TIMEZONE_OFFSET_HOURS[org.contact_window_timezone];
    const localMatch = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(sig.signed_local_at);
    if (offset === undefined || !localMatch) {
      add(`签署 ${sig.signature_id} 无法核对本地时间（${org.contact_window_timezone}）`);
    } else {
      const expected = new Date(t(sig.signed_utc_at) + offset * 3600000)
        .toISOString()
        .slice(0, 16)
        .replace('T', ' ');
      const actual = `${localMatch[1]} ${localMatch[2]}:${localMatch[3]}`;
      if (actual !== expected) {
        add(`签署 ${sig.signature_id} 本地时间 ${actual} 与 UTC ${sig.signed_utc_at} 在 ${org.contact_window_timezone} 下应为 ${expected}`);
      }
    }
  }

  // 撤回登记的工件版本状态必须确为 withdrawn，并汇总被其失效的证据。
  const invalidEvidence = new Set();
  for (const wd of gov.withdrawals) {
    const v = versionIndex.get(`${wd.artifact_type}|${wd.version}`);
    if (!v) {
      add(`撤回 ${wd.withdrawal_id} 指向不存在的工件 ${wd.artifact_type}@${wd.version}`);
      continue;
    }
    if (v.status !== 'withdrawn') {
      add(`撤回 ${wd.withdrawal_id}：${wd.artifact_type}@${wd.version} 状态不是 withdrawn`);
    }
    if (!v.withdrawal || t(v.withdrawal.withdrawn_at) !== t(wd.utc_at)) {
      add(`撤回 ${wd.withdrawal_id} 与工件版本内嵌的撤回记录时间不一致`);
    }
    for (const id of v.evidence_ids) invalidEvidence.add(id);
    for (const id of wd.cascades_to) invalidEvidence.add(id);
  }

  for (const ms of gov.funding_milestones) {
    if (ms.status === 'released' && invalidEvidence.has(ms.evidence_id)) {
      add(`资金里程碑 ${ms.milestone_id} 依据已撤回证据 ${ms.evidence_id} 放款，必须冻结`);
    }
  }

  for (const decision of gov.scale_decisions) {
    const ctx = `推广决定 ${decision.decision_id}`;
    if (!profileByCountry.has(decision.country)) {
      add(`${ctx}：国家 ${decision.country} 无本地化档案`);
    }
    const countryDeps = new Set(
      value.deployments.filter((d) => d.country === decision.country).map((d) => d.deployment_id),
    );

    const basisDrills = decision.basis_drill_ids.map((id) => {
      const d = drillById.get(id);
      if (!d) add(`${ctx} 引用了不存在的演练 ${id}`);
      return d;
    }).filter(Boolean);

    for (const d of basisDrills) {
      if (!countryDeps.has(d.deployment_id)) {
        add(`${ctx}：演练 ${d.drill_id} 不属于 ${decision.country} 的部署，不能作为该国推广依据`);
      }
      if (!d.result.passed) {
        add(`${ctx}：演练 ${d.drill_id} 未通过，不能作为推广依据`);
      }
      if (invalidEvidence.has(d.result.evidence_id)) {
        add(`${ctx}：演练 ${d.drill_id} 的证据 ${d.result.evidence_id} 已随成果撤回失效`);
      }
      if (t(d.concluded_at) > t(decision.decided_utc_at)) {
        add(`${ctx}：决定时间早于其依据演练 ${d.drill_id} 的结束时间`);
      }
    }

    for (const eid of decision.basis_operation_event_ids) {
      const e = degById.get(eid);
      if (!e) {
        add(`${ctx} 引用了不存在的运行事件 ${eid}`);
      } else if (!countryDeps.has(e.deployment_id)) {
        add(`${ctx}：运行事件 ${eid} 不属于 ${decision.country} 的部署`);
      } else if (invalidEvidence.has(eid)) {
        add(`${ctx}：运行事件 ${eid} 的证据已撤回失效`);
      } else if (t(e.utc_at) > t(decision.decided_utc_at)) {
        add(`${ctx}：决定时间早于运行事件 ${eid}`);
      }
    }

    if (decision.decision === 'expand') {
      const hasRealDrill = basisDrills.some(
        (d) => d.kind === 'live_event' && d.is_real_event_evidence && d.result.passed,
      );
      const hasFaultEvents = decision.basis_operation_event_ids.some((id) => {
        const e = degById.get(id);
        return e && e.trigger !== 'recovery' && e.automated;
      });
      if (!hasRealDrill) {
        add(`${ctx} 要求扩大推广，但缺少通过的真实事件值守演练证据（桌面/功能/模拟演练不足为据）`);
      }
      if (!hasFaultEvents) {
        add(`${ctx} 要求扩大推广，但缺少真实运行中的自动降级事件证据`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function statusLabel(status) {
  return ({
    draft: '草稿',
    superseded: '已被替代',
    withdrawn: '已撤回',
    issued: '现行',
  })[status] || status;
}
