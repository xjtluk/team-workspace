/**
 * 智能模型路由器
 *
 * 根据任务类型 + provider 健康度，动态选择最优模型。
 * 替代 cx-listener.mjs 中硬编码的降级链。
 *
 * 流程：classifyTask → selectProvider → reportResult
 */
import { TASK_ROUTES, TASK_KEYWORDS, PROVIDERS } from '../../config/model-allocation.js';
import { selectBest, report, rankProviders } from './provider-health.js';

/**
 * 任务分类器
 * @param {string} taskContent - 任务内容（用户消息）
 * @param {number} contextSize - 当前上下文大小（字符数）
 * @returns {'simple'|'code'|'file'|'batch'}
 */
function classifyTask(taskContent, contextSize = 0) {
  const text = (taskContent || '').toLowerCase();

  // 关键词匹配
  for (const [taskType, keywords] of Object.entries(TASK_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) {
        return taskType;
      }
    }
  }

  // 上下文大小判断：大上下文 → file
  if (contextSize > 20000) return 'file';

  // 默认：simple
  return 'simple';
}

/**
 * 为指定任务类型选择最优 provider
 * @param {'simple'|'code'|'file'|'batch'} taskType - 任务类型
 * @returns {{ provider: object, taskType: string, ranking: object[] }}
 */
function selectProvider(taskType) {
  const route = TASK_ROUTES[taskType] || TASK_ROUTES.simple;
  const { selected, all } = selectBest(route.candidates);

  if (!selected) {
    console.error(`[Router] 无可用 provider for ${taskType}`);
    return { provider: null, taskType, ranking: all };
  }

  const providerConfig = PROVIDERS[selected];
  const health = all.find(r => r.name === selected);

  // 路由决策日志
  console.log(`[Router] ${taskType} → ${providerConfig.name} (score=${health?.score}, candidates=${all.map(r => `${r.name}:${r.score}`).join(', ')})`);

  return {
    provider: {
      ...providerConfig,
      tierName: selected,
    },
    taskType,
    ranking: all,
  };
}

/**
 * 根据 provider 配置生成 modelOverride 对象（给 generateReply 用）
 * @param {object} provider - provider 配置
 * @returns {object} - { backend, openaiModel, openaiBaseUrl, openaiApiKey }
 */
function toModelOverride(provider) {
  if (!provider) return null;

  const apiKey = process.env[provider.apiKeyEnv]
    || (provider.fallbackKeyEnv ? process.env[provider.fallbackKeyEnv] : '')
    || '';

  return {
    backend: 'openai',
    openaiModel: provider.model,
    openaiBaseUrl: provider.baseUrl,
    openaiApiKey: apiKey,
  };
}

/**
 * 完整的路由流程：分类 → 选择 → 生成 override
 * @param {string} taskContent - 任务内容
 * @param {number} contextSize - 上下文大小
 * @returns {{ modelOverride: object, taskType: string, providerName: string, ranking: object[] }}
 */
function route(taskContent, contextSize = 0) {
  const taskType = classifyTask(taskContent, contextSize);
  const { provider, ranking } = selectProvider(taskType);
  const modelOverride = toModelOverride(provider);

  return {
    modelOverride,
    taskType,
    providerName: provider?.name || 'none',
    providerTierName: provider?.tierName || 'none',
    ranking,
  };
}

/**
 * 获取带 fallback 的路由列表（用于降级链）
 * @param {string} taskContent - 任务内容
 * @param {number} contextSize - 上下文大小
 * @returns {{ name: string, tier: object }[]} - 降级链列表
 */
function getRouteChain(taskContent, contextSize = 0) {
  const taskType = classifyTask(taskContent, contextSize);
  const routeConfig = TASK_ROUTES[taskType] || TASK_ROUTES.simple;
  const ranked = rankProviders(routeConfig.candidates);

  return ranked
    .filter(r => r.available)
    .map(r => ({
      name: PROVIDERS[r.name]?.name || r.name,
      tierName: r.name,
      tier: toModelOverride(PROVIDERS[r.name]),
      score: r.score,
    }));
}

export { classifyTask, selectProvider, toModelOverride, route, getRouteChain };
