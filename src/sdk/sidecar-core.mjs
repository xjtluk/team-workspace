/**
 * Sidecar Core — Agent Sidecar 公共模块
 *
 * WebSocket 连接管理（断线 fallback 到 HTTP 心跳）
 * 消息解析（@CC/@CX 检测）
 * 状态上报（POST /api/status）
 * 消息发送（POST /api/message）
 * Agent 注册（POST /api/register）
 */
import WebSocket from 'ws';

// Configuration
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3210';
const AGENT_DEFAULTS = {
  agentType: 'agent',
  color: '#10A37F',
};

// ── 429 重试工具 ──
async function retryFetch(url, options, maxRetries = 2) {
  for (let i = 0; i <= maxRetries; i++) {
    const res = await fetch(url, options);
    if (res.status === 429 && i < maxRetries) {
      const delay = Math.min(1000 * Math.pow(2, i), 5000);
      console.warn(`[HTTP] 429 Too Many Requests, ${delay}ms 后重试 (${i + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    return res;
  }
}

// WebSocket connection management
export class SidecarConnection {
  constructor(config) {
    this.agentId = config.agentId;
    this.agentName = config.agentName || config.agentId.toUpperCase();
    this.color = config.color || AGENT_DEFAULTS.color;
    this.model = config.model || '';
    this.serverUrl = config.serverUrl || SERVER_URL;
    this.wsUrl = this.serverUrl.replace(/^http/, 'ws');
    this.ws = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.lastMessageTime = 0;
    this.httpFallbackInterval = null;
    this.listeners = new Map();
    this._connected = false;
    this._reconnectTimer = null;
    this.lastSeenTimestamp = 0;
    this._offlinePulled = false;
    this._seenMessageIds = new Set();
  }

  // Event emitter
  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(callback);
    return this;
  }

  _emit(event, ...args) {
    const cbs = this.listeners.get(event);
    if (cbs) cbs.forEach(cb => cb(...args));
  }

  // Connect: register agent + WebSocket + HTTP fallback heartbeat
  async connect() {
    await this._register();
    this._connectWebSocket();
    this._startHttpFallback();
    this._startWatchdog();
  }

  async _register() {
    const res = await retryFetch(`${this.serverUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: this.agentId,
        name: this.agentName,
        agentType: AGENT_DEFAULTS.agentType,
        color: this.color,
      }),
    });
    if (res.status === 409) {
      console.log(`[${this.agentId}] Agent 已注册，跳过`);
      return;
    }
    if (!res.ok) throw new Error(`注册失败: ${res.status}`);
    console.log(`[${this.agentId}] Agent 注册成功`);
  }

  async _connectWebSocket() {
    let wsToken = '';
    try {
      const res = await fetch(`${this.serverUrl}/api/auth/token`);
      const data = await res.json();
      wsToken = data.token || '';
    } catch (e) {
      console.warn(`[${this.agentId}] 获取 WS Token 失败: ${e.message}`);
    }

    this.ws = new WebSocket(`${this.wsUrl}/ws?token=${wsToken}`);

    this.ws.on('open', () => {
      console.log(`[${this.agentId}] WebSocket 已连接`);
      this._connected = true;
      this.reconnectDelay = 1000;
      this.lastMessageTime = Date.now();
      this._emit('connected');
      this._pullOfflineOnConnect();
    });

    this.ws.on('close', (code) => {
      this._connected = false;
      this._offlinePulled = false;
      console.log(`[${this.agentId}] WebSocket 断开 (${code})，${this.reconnectDelay}ms后重连`);
      this._scheduleReconnect();
      this._emit('disconnected');
    });

    this.ws.on('error', (err) => {
      console.error(`[${this.agentId}] WebSocket 错误: ${err.message}`);
    });

    this.ws.on('message', (data) => {
      this.lastMessageTime = Date.now();
      try {
        const event = JSON.parse(data.toString());
        // 统一走 _processNewMessages 去重，防止 WebSocket 和离线拉取重复
        if (event.type === 'new_message' && event.payload) {
          this._processNewMessages([event.payload]);
        } else {
          this._emit('message', event);
        }
      } catch (e) {
        console.error(`[${this.agentId}] 消息解析失败: ${e.message}`);
      }
    });

    this.ws.on('pong', () => {
      this.lastMessageTime = Date.now();
    });
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connectWebSocket();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  _startHttpFallback() {
    this.httpFallbackInterval = setInterval(async () => {
      try {
        const res = await retryFetch(`${this.serverUrl}/api/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: this.agentId, model: this.model, lastSeenTimestamp: this.lastSeenTimestamp }),
        });
        const data = await res.json();

        // 首次上线 → 拉取离线消息
        this._pullOfflineOnConnect();

        // 处理心跳响应中的新消息（基于 lastSeenTimestamp 增量）
        if (data.newMessages?.length) {
          this._processNewMessages(data.newMessages);
        }

        // 更新时间戳
        if (data.serverTimestamp) {
          this.lastSeenTimestamp = data.serverTimestamp;
        }
      } catch {}
    }, 15000);
  }

  // 拉取离线消息（仅首次连接时调用一次）
  async _pullOfflineOnConnect() {
    if (this._offlinePulled) return;
    this._offlinePulled = true;
    try {
      const res = await retryFetch(`${this.serverUrl}/api/offline/pull?agentId=${encodeURIComponent(this.agentId)}`);
      const data = await res.json();
      if (data.ok && data.messages?.length) {
        console.log(`[${this.agentId}] 拉取到 ${data.messages.length} 条离线消息`);
        this._processNewMessages(data.messages);
      }
    } catch (e) {
      console.error(`[${this.agentId}] 离线消息拉取失败: ${e.message}`);
    }
  }

  // 协议消息过滤（在 core 层统一拦截，不派发给 handler）
  _isProtocolMessage(content) {
    if (!content) return true;
    if (content.includes('[收到]')) return true;
    if (content.includes('[问题]')) return true;
    if (content.includes('[完成]')) return true;
    if (content.includes('[子任务完成]')) return true;
    if (content.trim() === 'hb') return true;
    if (content.startsWith('当前任务执行中')) return true;
    return false;
  }

  // 新消息处理 — 去重 + 协议过滤 + 触发 message 事件
  _processNewMessages(messages) {
    if (!messages?.length) return;
    for (const msg of messages) {
      if (this._seenMessageIds.has(msg.id)) continue;
      this._seenMessageIds.add(msg.id);
      // core 层拦截协议消息
      if (this._isProtocolMessage(msg.content)) continue;
      this._emit('message', {
        type: 'new_message',
        payload: {
          id: msg.id,
          from: msg.from,
          fromName: msg.fromName,
          content: msg.content,
          type: msg.type,
          channel: msg.channel,
          timestamp: msg.timestamp,
          replyTo: msg.replyTo,
        },
      });
    }
    // 防止 Set 无限增长
    if (this._seenMessageIds.size > 10000) {
      this._seenMessageIds = new Set([...this._seenMessageIds].slice(-5000));
    }
  }

  _startWatchdog() {
    setInterval(() => {
      if (this._connected && Date.now() - this.lastMessageTime > 90000) {
        console.warn(`[${this.agentId}] WebSocket 假死（90秒无消息），强制重连`);
        try { this.ws?.terminate(); } catch {}
      }
    }, 30000);
  }

  async disconnect() {
    if (this.httpFallbackInterval) clearInterval(this.httpFallbackInterval);
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this.ws) try { this.ws.close(); } catch {}
    this._connected = false;
  }

  isConnected() { return this._connected; }
}

// Message parsing
export function isAtAgent(content, agentId) {
  if (!content) return false;
  const atPattern = new RegExp(`@${agentId}`, 'i');
  return atPattern.test(content);
}

export function parseMention(content) {
  if (!content) return [];
  const mentions = content.match(/@(\w+)/g);
  return mentions ? mentions.map(m => m.slice(1).toLowerCase()) : [];
}

// Status reporting (with 429 retry)
export async function reportStatus(agentId, status, activity = '', progress = 0, options = {}) {
  try {
    const res = await retryFetch(`${SERVER_URL}/api/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, status, activity, progress, model: options.model || '', ...options }),
    });
    return res.ok;
  } catch (e) {
    console.error(`[${agentId}] 状态上报失败: ${e.message}`);
    return false;
  }
}

// Message sending (with 429 retry)
export async function sendMessage(from, content, channel = 'group') {
  try {
    const res = await retryFetch(`${SERVER_URL}/api/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, content, channel }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.status);
    }
    return true;
  } catch (e) {
    console.error(`[${from}] 消息发送失败: ${e.message}`);
    return false;
  }
}