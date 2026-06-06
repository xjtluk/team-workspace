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
    const res = await fetch(`${this.serverUrl}/api/register`, {
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
    });

    this.ws.on('close', (code) => {
      this._connected = false;
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
        this._emit('message', event);
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
      // 始终发送心跳（带model），不管WebSocket是否连接
      // WebSocket只传消息事件，不传model同步
      try {
        await fetch(`${this.serverUrl}/api/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: this.agentId, model: this.model }),
        });
      } catch {}
    }, 15000);
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

// Status reporting
export async function reportStatus(agentId, status, activity = '', progress = 0, options = {}) {
  try {
    const res = await fetch(`${SERVER_URL}/api/status`, {
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

// Message sending
export async function sendMessage(from, content, channel = 'group') {
  try {
    const res = await fetch(`${SERVER_URL}/api/message`, {
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
