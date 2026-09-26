// 参赛项目与七国机构资料的查询。
// 关键边界：获奖是竞赛事实，部署许可是独立的行政事实，两者不得互相推导。

export function loadRegistry(projectsDoc, agenciesDoc) {
  if (!Array.isArray(projectsDoc?.projects) || !projectsDoc.projects.length) {
    throw new Error('参赛项目清单为空');
  }
  if (!Array.isArray(agenciesDoc?.agencies) || agenciesDoc.agencies.length !== 7) {
    throw new Error('七国机构资料必须恰好包含七个国家');
  }
  const projects = new Map(projectsDoc.projects.map((p) => [p.project_id, p]));
  const agencies = new Map(agenciesDoc.agencies.map((a) => [a.country_code, a]));
  return {
    projects,
    agencies,
    getProject(projectId) {
      const p = projects.get(projectId);
      if (!p) throw new Error(`未登记的项目：${projectId}`);
      return p;
    },
    getAgency(countryCode) {
      const a = agencies.get(countryCode);
      if (!a) throw new Error(`未登记的国家：${countryCode}`);
      return a;
    }
  };
}

// 获奖不授予任何部署权利；只有主管机构发放的 pilot/full 许可且载明发放机构才算数。
// 注意：清单层面的许可仍不替代具体国家的试点准入（见 pilot.js 四项闸门）。
export function hasDeploymentLicense(project) {
  if (project.license?.deployment_license === 'none') return false;
  const issued = project.license?.issued_by ?? [];
  return issued.length > 0;
}

// 原演示环境与本地环境在四个维度上逐项比对，凡不同的维度都必须本地化适配，
// 并由本地化评审闸门留存证据（本函数只指出差异，不判定适配是否完成）。
export function environmentDifferences(project, agency) {
  const demo = project.origin_demo;
  const diffs = [];
  if (!agency.languages.includes(demo.language)) diffs.push('language');
  if (demo.hazard_scale_id !== agency.hazard_scale.scale_id) diffs.push('hazard_scale');
  if (demo.data_regime.country_code !== agency.country_code) diffs.push('data_export_regime');
  else if (demo.data_regime.outbound_allowed && agency.data_export.requires_authorization) {
    diffs.push('data_export_regime');
  }
  return diffs;
}

// 试点站点实际具备的传感器必须覆盖设备依赖声明；缺雷达等关键源时能力要降级声明。
export function sensorCoverage(project, site) {
  const demoSensors = project.origin_demo.sensor_profile.sensors;
  const available = new Set(site.sensors_available);
  // 演示环境与本地设备名称不同，这里只给出结构性检查：本地至少要有两类独立传感源。
  return {
    available: site.sensors_available,
    missing_from_demo: demoSensors.filter((s) => !available.has(s)),
    independentSourceCount: new Set(site.sensors_available).size,
    meetsMinimum: new Set(site.sensors_available).size >= 2
  };
}
