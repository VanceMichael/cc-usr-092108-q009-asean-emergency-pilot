// 跨境共享：只共享获准的预警摘要。
// 一份载荷要出境，必须同时满足：
//  1. 数据授权要求已满足（调用方传入 authorized）；
//  2. 每个字段都在该国出境白名单内；
//  3. 每个字段都在产品声明的摘要字段内；
//  4. 不触碰该国明令禁止的字段。
// 原始站点数据、传感器健康、操作人记录等永远不得出境。

export function sanitizeForExport(agency, product, payload, authorized) {
  if (agency.data_export.requires_authorization && !authorized) {
    return {
      allowed: false,
      summary: null,
      violations: ['数据出境授权未取得']
    };
  }
  if (!product.cross_border_sharing?.summary_only) {
    return { allowed: false, summary: null, violations: ['产品未声明仅共享摘要'] };
  }

  const countryWhitelist = new Set(agency.data_export.allowed_outbound_fields);
  const productFields = new Set(product.cross_border_sharing.fields);
  const forbidden = new Set(agency.data_export.forbidden_fields ?? []);

  const violations = [];
  for (const key of Object.keys(payload)) {
    if (forbidden.has(key)) violations.push(`禁出字段被夹带：${key}`);
    else if (!countryWhitelist.has(key)) violations.push(`字段不在该国出境白名单：${key}`);
    else if (!productFields.has(key)) violations.push(`字段不在获准摘要范围：${key}`);
  }

  if (violations.length) return { allowed: false, summary: null, violations };

  // 跨国只比较 rank，不输出任何一国本地的等级代码，避免分级口径混淆。
  const summary = { ...payload };
  return { allowed: true, summary, violations: [] };
}

// 把本国灾种等级代码转成跨国中性的严重度 rank。
export function toSeverityRank(agency, localCode) {
  const level = agency.hazard_scale.levels.find((l) => l.code === localCode);
  if (!level) throw new Error(`${agency.country_code} 未登记的灾种等级：${localCode}`);
  return level.rank;
}
