/**
 * Agent Client SDK — 团队工作室 Agent 接入模块
 *
 * 用法：
 *   import { createAgent } from './sdk/agent-client.js';
 *
 *   const agent = createAgent({
 *     id: 'cc',
 *     name: 'CC',
 *     color: '#4A90D9',
 *     gridFile: 'grids/clawd.js',
 *   });
 *
 *   await agent.connect();       // 注册 + 启动心跳
 *   await agent.work('正在写代码', 30);
 *   await agent.send('任务完成');
 *   await agent.disconnect();    // 标记离线 + 停止心跳
 */

const DEFAULT_OPTIONS = {
  serverUrl: 'http://localhost:3210',
  heartbeatInterval: 15000,  // 15 秒
  agentType: 'agent',
};

/**
 * 创建 Agent 客户端实例
 * @param {Object} config
 * @param {string} config.id         — Agent ID（与 agents 表一致）
 * @param {string} config.name       — 显示名
 * @param {string} [config.color]    — 角色主色
 * @param {string} [config.gridFile] — 像素网格数据文件路径
 * @param {string} [config.serverUrl]— 服务端地址，默认 http://localhost:3210
 * @returns {Object} agent 客户端接口
 */
export function createAgent(config) {
  const opts = { ...DEFAULT_OPTIONS, ...config };
  const { id, name, serverUrl } = opts;

  if (!id || !name) {
    throw new Error('[AgentClient] id and name are required');
  }

  let heartbeatTimer = null;
  let connected = false;
  let onMessageCallback = null;

  // ── HTTP 请求辅助 ──

  async function post(path, body) {
    const res = await fetch(`${serverUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`[AgentClient] ${path} failed: ${err.error || res.status}`);
    }
    return res.json();
  }

  // ── 核心接口 ──

  /**
   * 注册 Agent（如果已存在则跳过）+ 启动心跳
   */
  async function connect() {
    if (connected) return;

    try {
      await post('/api/register', {
        id,
        name,
        agentType: opts.agentType,
        color: opts.color || '#4A90D9',
        gridFile: opts.gridFile || null,
      });
    } catch (err) {
      // 409 = 已注册，可忽略
      if (!err.message.includes('409') && !err.message.includes('already exists')) {
        throw err;
      }
    }

    // 启动心跳（含离线消息拉取）
    heartbeatTimer = setInterval(async () => {
      try {
        const data = await post('/api/heartbeat', { agentId: id });
        // 离线期间有排队消息 → 拉取并回调
        if (data.pendingMessages > 0 && onMessageCallback) {
          const history = await fetch(`${serverUrl}/api/history?limit=${data.pendingMessages}`)
            .then(r => r.json());
          if (history.messages) {
            history.messages.forEach(msg => onMessageCallback(msg));
          }
        }
      } catch {}
    }, opts.heartbeatInterval);

    // 上报在线状态
    await post('/api/status', {
      agentId: id,
      status: 'idle',
      activity: '',
      progress: 0,
    }).catch(() => {});

    connected = true;
    return { ok: true, id };
  }

  /**
   * 上报工作状态
   * @param {string} activity — 当前活动描述
   * @param {number} progress — 进度 0-100
   * @param {string} [location] — 可选位置覆盖
   */
  async function work(activity, progress = 0, location) {
    assertConnected();
    return post('/api/status', {
      agentId: id,
      status: 'working',
      activity,
      progress: Math.min(100, Math.max(0, progress)),
      ...(location && { location }),
    });
  }

  /**
   * 上报空闲状态
   */
  async function idle(activity = '') {
    assertConnected();
    return post('/api/status', {
      agentId: id,
      status: 'idle',
      activity,
      progress: 0,
    });
  }

  /**
   * 上报错误状态
   * @param {string} activity — 错误描述
   */
  async function error(activity) {
    assertConnected();
    return post('/api/status', {
      agentId: id,
      status: 'error',
      activity,
      progress: 0,
    });
  }

  /**
   * 上报讨论状态
   * @param {string} activity — 讨论主题
   */
  async function talk(activity) {
    assertConnected();
    return post('/api/status', {
      agentId: id,
      status: 'talking',
      activity,
      progress: 0,
    });
  }

  /**
   * 发送消息到群聊
   * @param {string} content — 消息内容（支持 Markdown）
   * @param {string} [type]  — 消息类型，默认 'text'
   * @param {string} [replyTo] — 回复的消息 ID
   * @param {string} [channel] — 频道，默认 'group'
   */
  async function send(content, type = 'text', replyTo = null, channel = 'group') {
    assertConnected();
    return post('/api/message', {
      from: id,
      content,
      type,
      channel,
      ...(replyTo && { replyTo }),
    });
  }

  /**
   * 执行任务的封装：自动管理状态流转
   * 工作期间只上报状态，不发消息（符合"执行任务时不回聊天"的约定）
   *
   * @param {string}   taskDesc    — 任务描述
   * @param {Function} taskFn      — 实际执行的异步函数，接收 { onProgress } 回调
   * @returns {*} taskFn 的返回值
   */
  async function executeTask(taskDesc, taskFn) {
    assertConnected();

    await work(taskDesc, 0);

    const onProgress = (progress, detail) => {
      work(detail || taskDesc, progress).catch(() => {});
    };

    try {
      const result = await taskFn({ onProgress });
      await idle();
      return result;
    } catch (err) {
      await error(`${taskDesc} — ${err.message}`);
      throw err;
    }
  }

  /**
   * 注册离线消息回调（上线后收到排队消息时触发）
   * @param {Function} callback — (message) => void
   */
  function onMessage(callback) {
    onMessageCallback = callback;
  }

  /**
   * 断开连接：标记离线 + 停止心跳
   */
  async function disconnect() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    if (connected) {
      await post('/api/status', {
        agentId: id,
        status: 'offline',
        activity: '',
        progress: 0,
      }).catch(() => {});
    }

    connected = false;
  }

  // ── 内部辅助 ──

  function assertConnected() {
    if (!connected) {
      throw new Error('[AgentClient] Not connected. Call agent.connect() first.');
    }
  }

  // ── 导出接口 ──

  return {
    id,
    name,
    get connected() { return connected; },
    connect,
    disconnect,
    work,
    idle,
    error,
    talk,
    send,
    executeTask,
    onMessage,
  };
}
