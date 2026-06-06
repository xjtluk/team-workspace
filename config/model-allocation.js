/**
 * 模型分配配置 — 智能路由的规则定义
 *
 * 任务类型 → 候选 provider 列表（按优先级排序）
 * provider 定义：名称、base URL、API key 环境变量、模型名、上下文窗口大小
 *
 * 路由逻辑在 model-router.js 中，本文件只做配置。
 */

// ── Provider 定义 ──
// 每个 provider 包含：name, baseUrl, apiKeyEnv, model, contextWindow (字符数)
export const PROVIDERS = {
  // ── 硅基流动（已充值）──
  siliconflowPro: {
    name: '硅基 DS4 Pro',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
    model: 'deepseek-ai/DeepSeek-V4-Pro',
    contextWindow: 128000,
    speed: 'slow',      // Pro 推理慢但质量高
    cost: 'paid',
  },
  siliconflowFlash: {
    name: '硅基 DS4 Flash',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
    model: 'deepseek-ai/DeepSeek-V4-Flash',
    contextWindow: 128000,
    speed: 'fast',
    cost: 'paid',
  },

  // ── TaoToken（已充值）──
  taotokenPro: {
    name: 'TaoToken DS4 Pro',
    baseUrl: 'https://taotoken.net/api/v1',
    apiKeyEnv: 'TAOTOKEN_API_KEY',
    model: 'deepseek-v4-pro',
    contextWindow: 128000,
    speed: 'slow',
    cost: 'paid',
  },
  taotokenFlash: {
    name: 'TaoToken DS4 Flash',
    baseUrl: 'https://taotoken.net/api/v1',
    apiKeyEnv: 'TAOTOKEN_API_KEY',
    model: 'deepseek-v4-flash',
    contextWindow: 128000,
    speed: 'fast',
    cost: 'paid',
  },

  // ── 火山方舟 ──
  volcFlash: {
    name: '火山 DS4 Flash',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKeyEnv: 'ARK_API_KEY',
    model: 'ep-20260602221852-f6q4v',
    contextWindow: 128000,
    speed: 'fast',
    cost: 'paid',
  },

  // ── 智谱（GLM-4.7 额度多优先用完，Flash 永久免费兜底）──
  zhipuGLM: {
    name: '智谱 GLM-4.7',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyEnv: 'ZHIPU_API_KEY_CX',
    fallbackKeyEnv: 'ZHIPU_API_KEY_XIAOMA',
    model: 'glm-4.7',
    contextWindow: 128000,
    speed: 'medium',
    cost: 'quota',      // 额度多，优先用完
  },
  zhipuFlash: {
    name: '智谱 GLM-Flash',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyEnv: 'ZHIPU_API_KEY_CX',
    fallbackKeyEnv: 'ZHIPU_API_KEY_XIAOMA',
    model: 'glm-4.7-flash',
    contextWindow: 128000,
    speed: 'fast',
    cost: 'free',       // 永久免费
  },
};

// ── 任务类型 → 候选 provider ──
// 按优先级排序，路由时从第一个开始选
export const TASK_ROUTES = {
  // 简单对话：低延迟 + 免费优先
  simple: {
    description: '短消息回复、状态查询、简单确认',
    candidates: ['zhipuFlash', 'siliconflowFlash', 'taotokenFlash'],
    maxContextForTask: 5000,
  },

  // 代码任务：强推理优先（Pro 模型）
  code: {
    description: '代码实现、重构、调试、复杂逻辑',
    candidates: ['siliconflowPro', 'taotokenPro', 'siliconflowFlash', 'zhipuGLM'],
    maxContextForTask: 50000,
  },

  // 文件操作：大上下文 + 额度优先用完
  file: {
    description: '文件读写、搜索、批量操作',
    candidates: ['zhipuGLM', 'siliconflowFlash', 'taotokenFlash', 'zhipuFlash'],
    maxContextForTask: 100000,
  },

  // 批量任务：稳定性 + 额度优先
  batch: {
    description: '批量测试、API 调用、长时间运行',
    candidates: ['zhipuGLM', 'siliconflowFlash', 'taotokenFlash', 'zhipuFlash'],
    maxContextForTask: 80000,
  },
};

// ── 任务分类关键词 ──
export const TASK_KEYWORDS = {
  code: [
    '代码', '实现', '重构', '修复', 'bug', '函数', '组件', '接口',
    '写代码', '改代码', 'implement', 'refactor', 'fix', 'code',
    '编写', '修改文件', '新增文件', 'create', 'write',
  ],
  file: [
    '读取', '查看', '搜索', '查找', '文件', '目录', 'read', 'search',
    '批量', '文件操作', 'list', 'grep', 'find',
  ],
  batch: [
    '测试', '部署', '构建', 'test', 'deploy', 'build', 'npm',
    '批量', '全部', '所有', 'batch',
  ],
};
