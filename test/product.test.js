import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parsePilotProduct, validateProduct } from '../src/product.js';

const raw = await readFile(new URL('../fixtures/pilot-product.json', import.meta.url), 'utf8');
const product = parsePilotProduct(raw);

// 返回样例的深拷贝，每个反例测试独立改一处。
function clone() {
  return structuredClone(product);
}

function validate(v = product) {
  return validateProduct(v);
}

// 断言变更后恰好出现包含片段的错误。
function expectError(mutator, fragment) {
  const v = mutator(clone());
  const result = validate(v);
  assert.equal(result.ok, false, '预期校验失败，但通过了');
  assert.ok(
    result.errors.some((e) => e.includes(fragment)),
    `预期错误包含「${fragment}」，实际：\n${result.errors.join('\n')}`,
  );
}

test('虚构样例通过全部业务不变量校验', () => {
  const result = validate();
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('资料缺少必要字段时解析失败', () => {
  assert.throws(() => parsePilotProduct('{"product_id":"x"}'), /缺少必要字段/);
  assert.throws(() => parsePilotProduct('{not-json'), SyntaxError);
});

test('获奖结果不能作为上线许可', () => {
  expectError(
    (v) => {
      v.source_project.award_is_operational_license = true;
      return v;
    },
    'award_is_operational_license 必须恒为 false',
  );
});

test('真实值守部署缺少任一闸门即被拒（数据授权）', () => {
  expectError(
    (v) => {
      v.deployments.find((d) => d.deployment_id === 'dep-vn-danang').gates.data_authorization.passed = false;
      return v;
    },
    '闸门未全部通过：数据授权',
  );
});

test('标记闸门拦截却没有失败闸门，状态自相矛盾', () => {
  expectError(
    (v) => {
      const th = v.country_profiles.find((p) => p.country === 'TH');
      th.data_egress_rules.authorization_granted = true;
      th.data_egress_rules.allowed_categories = ['approved_alert_summary'];
      const dep = v.deployments.find((d) => d.deployment_id === 'dep-th-surat');
      dep.gates.data_authorization.passed = true;
      return v;
    },
    '状态自相矛盾',
  );
});

test('本地化闸门与国家语言授权状态必须一致', () => {
  expectError(
    (v) => {
      v.country_profiles.find((p) => p.country === 'VN').language.ui_approved = false;
      return v;
    },
    '界面语言尚未获准',
  );
});

test('部署只能钉用七族工件的现行精确版本：已撤回版本被拒', () => {
  expectError(
    (v) => {
      const dep = v.deployments.find((d) => d.deployment_id === 'dep-vn-danang');
      dep.pinned_artifacts.find((r) => r.type === 'technical_capability').version = '1.0.0';
      return v;
    },
    '已撤回工件 technical_capability@1.0.0',
  );
});

test('部署钉用的工件版本必须声明适用于该国', () => {
  expectError(
    (v) => {
      const dep = v.deployments.find((d) => d.deployment_id === 'dep-vn-danang');
      dep.pinned_artifacts.find((r) => r.type === 'deployment_site').version = '1.1.0';
      return v;
    },
    '未声明适用于 VN',
  );
});

test('钉版引用必须七族齐全', () => {
  expectError(
    (v) => {
      const dep = v.deployments.find((d) => d.deployment_id === 'dep-vn-danang');
      dep.pinned_artifacts = dep.pinned_artifacts.filter((r) => r.type !== 'rollback_plan' && r.type !== 'acceptance_metric');
      return v;
    },
    '七族工件各钉一个精确版本',
  );
});

test('非真实事件演练不得标记为真实证据', () => {
  expectError(
    (v) => {
      v.drills.find((d) => d.drill_id === 'd-th-tt-01').is_real_event_evidence = true;
      return v;
    },
    '不得标记 is_real_event_evidence',
  );
});

test('影子运行部署不得产生真实事件值守证据', () => {
  expectError(
    (v) => {
      v.drills.find((d) => d.drill_id === 'd-ph-func-01').kind = 'live_event';
      return v;
    },
    '非真实值守部署',
  );
});

test('被闸门拦截的站点只允许桌面推演', () => {
  expectError(
    (v) => {
      v.drills.find((d) => d.drill_id === 'd-th-tt-01').kind = 'functional';
      return v;
    },
    '只允许桌面推演',
  );
});

test('台风事件顺序必须按 UTC 严格递增', () => {
  expectError(
    (v) => {
      const seq = v.drills.find((d) => d.drill_id === 'd-vn-fs-01').typhoon_sequence;
      const tmp = seq[2].utc_at;
      seq[2].utc_at = seq[3].utc_at;
      seq[3].utc_at = tmp;
      return v;
    },
    'UTC 时间必须严格递增',
  );
});

test('台风阶段不能颠倒（洪涝先于登陆）', () => {
  expectError(
    (v) => {
      const seq = v.drills.find((d) => d.drill_id === 'd-vn-fs-01').typhoon_sequence;
      const tmp = seq[2].phase;
      seq[2].phase = seq[3].phase;
      seq[3].phase = tmp;
      return v;
    },
    '阶段顺序错误',
  );
});

test('故障触发的自动降级只能向更低档位移', () => {
  expectError(
    (v) => {
      v.operations.degradation_events.find((e) => e.event_id === 'deg-vn-01').to_level = 'L3_autonomous';
      return v;
    },
    '故障触发只能降档',
  );
});

test('降级到 L0 必须留下人工接管记录', () => {
  expectError(
    (v) => {
      v.operations.degradation_events.find((e) => e.event_id === 'deg-vn-03').takeover_record_id = null;
      return v;
    },
    '必须留下人工接管记录编号',
  );
});

test('接管人员必须来自该部署的责任机构并持证', () => {
  expectError(
    (v) => {
      v.operations.manual_takeovers.find((r) => r.record_id === 'tk-vn-01').operator_org_id = 'TH-NDMR';
      return v;
    },
    '不是部署 dep-vn-danang 的责任机构',
  );
});

test('真实值守注入必须与实际自动降级事件一一对应', () => {
  expectError(
    (v) => {
      v.drills.find((d) => d.drill_id === 'd-vn-live-01').injects[0].utc_at = '2026-08-24T21:11:00Z';
      return v;
    },
    '缺少对应的实际自动降级事件',
  );
});

test('跨境共享未经授权即被拒', () => {
  expectError(
    (v) => {
      v.cross_border_sharing.shared_items[0].authorized = false;
      return v;
    },
    '共享未经授权',
  );
});

test('跨境只能共享获准的预警摘要，原始读数被拒', () => {
  expectError(
    (v) => {
      v.cross_border_sharing.shared_items[0].category = 'raw_sensor_reading';
      return v;
    },
    '只允许共享获准的预警摘要',
  );
});

test('发送国未授权数据出境时不得共享', () => {
  expectError(
    (v) => {
      v.country_profiles.find((p) => p.country === 'VN').data_egress_rules.authorization_granted = false;
      return v;
    },
    '未授权预警摘要出境',
  );
});

test('签署的本地时间必须与 UTC 及时区自洽', () => {
  expectError(
    (v) => {
      v.governance.signatures.find((s) => s.signature_id === 'sig-03').signed_local_at = '2026-07-03 08:00 +07';
      return v;
    },
    '与 UTC',
  );
});

test('撤回登记必须与工件撤回状态一致', () => {
  expectError(
    (v) => {
      v.artifacts.technical_capability.versions.find((x) => x.version === '1.0.0').status = 'issued';
      return v;
    },
    '状态不是 withdrawn',
  );
});

test('依据已撤回证据放款的资金里程碑必须冻结', () => {
  expectError(
    (v) => {
      v.governance.funding_milestones.find((m) => m.milestone_id === 'fm-02').evidence_id = 'EV-CAP-100';
      return v;
    },
    '依据已撤回证据',
  );
});

test('扩大推广不能只凭模拟演练：缺少真实事件值守证据即被拒', () => {
  expectError(
    (v) => {
      const d = v.governance.scale_decisions.find((x) => x.decision_id === 'sd-vn-expand');
      d.basis_drill_ids = ['d-vn-fs-01'];
      return v;
    },
    '缺少通过的真实事件值守演练证据',
  );
});

test('扩大推广必须有真实运行中的自动降级证据', () => {
  expectError(
    (v) => {
      v.governance.scale_decisions.find((x) => x.decision_id === 'sd-vn-expand').basis_operation_event_ids = [];
      return v;
    },
    '缺少真实运行中的自动降级事件证据',
  );
});

test('推广决定时间不得早于其依据的演练结束时间', () => {
  expectError(
    (v) => {
      v.governance.scale_decisions.find((x) => x.decision_id === 'sd-vn-expand').decided_utc_at = '2026-08-01T00:00:00Z';
      return v;
    },
    '决定时间早于其依据演练',
  );
});

test('他国演练不能作为本国推广依据', () => {
  expectError(
    (v) => {
      const d = v.governance.scale_decisions.find((x) => x.decision_id === 'sd-ph-hold');
      d.decision = 'expand';
      d.basis_drill_ids = ['d-vn-live-01'];
      d.basis_operation_event_ids = ['deg-vn-03'];
      return v;
    },
    '不能作为该国推广依据',
  );
});

test('机构资料至少覆盖七个国家', () => {
  expectError(
    (v) => {
      v.organizations = v.organizations.filter((o) => o.country !== 'KH');
      return v;
    },
    '至少覆盖 7 个国家',
  );
});
