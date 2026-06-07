/**
 * Message Schema - 统一消息格式约束
 * 
 * 目标：定义消息格式，发送前/接收前校验，杜绝格式错误
 * 对标：Routa (OpenAPI 3.1) / ClawTeam (Pydantic)
 */

// 消息类型枚举
export const MESSAGE_TYPES = {
  TEXT: 'text',
  SYSTEM: 'system',
  STATUS: 'status',
  TASK: 'task',
  ERROR: 'error',
};

// 频道枚举
export const CHANNELS = {
  GROUP: 'group',
  DM_CC: 'dm_cc',
  DM_CX: 'dm_cx',
  DM_XIAOMA: 'dm_xiaoma',
};

// 协议消息前缀（不需要 Schema 校验）
const PROTOCOL_PREFIXES = [
  '[收到]',
  '[问题]',
  '[完成]',
  '[子任务完成]',
];

/**
 * 消息 Schema 定义
 */
export const MessageSchema = {
  // 必填字段
  required: ['id', 'from', 'content', 'timestamp'],
  
  // 字段类型约束
  properties: {
    id: { type: 'string', pattern: '^[a-zA-Z0-9_-]+$' }, // 消息 ID（自由格式，但必须是字符串）
    from: { type: 'string', enum: ['cc', 'cx', 'xiaoma', 'kk', 'hermes'] },
    fromName: { type: 'string', minLength: 1, maxLength: 50 },
    content: { type: 'string', minLength: 1, maxLength: 10000 },
    type: { type: 'string', enum: Object.values(MESSAGE_TYPES) },
    channel: { type: 'string', enum: Object.values(CHANNELS) },
    timestamp: { type: 'number', minimum: 0 },
    replyTo: { type: 'string', optional: true },
  },
  
  // 默认值
  defaults: {
    type: MESSAGE_TYPES.TEXT,
    channel: CHANNELS.GROUP,
    timestamp: () => Date.now(),
  },
};

/**
 * 校验消息对象
 * @param {Object} message - 待校验的消息
 * @returns {{ valid: boolean, errors: string[], message: Object }}
 */
export function validateMessage(message) {
  const errors = [];
  const normalized = { ...message };
  
  // 1. 检查协议消息（跳过 Schema 校验）
  if (message.content && PROTOCOL_PREFIXES.some(p => message.content.startsWith(p))) {
    return { valid: true, errors: [], message: normalized, isProtocol: true };
  }
  
  // 2. 检查必填字段
  for (const field of MessageSchema.required) {
    if (!(field in normalized) || normalized[field] === undefined || normalized[field] === null) {
      errors.push(`缺少必填字段: ${field}`);
    }
  }
  
  // 3. 类型校验
  for (const [field, config] of Object.entries(MessageSchema.properties)) {
    if (field in normalized && normalized[field] !== undefined && normalized[field] !== null) {
      const value = normalized[field];

      // 类型检查
      if (config.type === 'string' && typeof value !== 'string') {
        errors.push(`字段 ${field} 必须是字符串`);
      } else if (config.type === 'number' && typeof value !== 'number') {
        errors.push(`字段 ${field} 必须是数字`);
      }
      
      // 枚举检查
      if (config.enum && !config.enum.includes(value)) {
        errors.push(`字段 ${field} 必须是以下值之一: ${config.enum.join(', ')}`);
      }
      
      // 长度检查
      if (typeof value === 'string') {
        if (config.minLength && value.length < config.minLength) {
          errors.push(`字段 ${field} 长度必须 >= ${config.minLength}`);
        }
        if (config.maxLength && value.length > config.maxLength) {
          errors.push(`字段 ${field} 长度必须 <= ${config.maxLength}`);
        }
      }
      
      // 数值范围检查
      if (typeof value === 'number') {
        if (config.minimum !== undefined && value < config.minimum) {
          errors.push(`字段 ${field} 必须 >= ${config.minimum}`);
        }
        if (config.maximum !== undefined && value > config.maximum) {
          errors.push(`字段 ${field} 必须 <= ${config.maximum}`);
        }
      }
    }
  }
  
  // 4. 应用默认值
  for (const [field, defaultValue] of Object.entries(MessageSchema.defaults)) {
    if (!(field in normalized) || normalized[field] === undefined) {
      normalized[field] = typeof defaultValue === 'function' ? defaultValue() : defaultValue;
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    message: normalized,
  };
}

/**
 * 创建标准消息对象
 * @param {Object} params - 消息参数
 * @returns {Object} 标准消息对象
 */
export function createMessage(params) {
  const message = {
    id: params.id || generateMessageId(),
    from: params.from,
    fromName: params.fromName || params.from,
    content: params.content,
    type: params.type || MESSAGE_TYPES.TEXT,
    channel: params.channel || CHANNELS.GROUP,
    timestamp: params.timestamp || Date.now(),
    replyTo: params.replyTo || null,
  };
  
  const { valid, errors, message: validated } = validateMessage(message);
  if (!valid) {
    console.warn('[MessageSchema] 消息校验失败:', errors);
    return null;
  }
  
  return validated;
}

/**
 * 生成消息 ID（改进版：使用 crypto.randomUUID + timestamp）
 * 修复历史问题：Date.now() + Math.random() 导致的 ID 碰撞
 */
export function generateMessageId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  const cryptoRandom = typeof crypto !== 'undefined' && crypto.randomUUID 
    ? crypto.randomUUID().split('-')[0] 
    : Math.random().toString(36).substring(2, 10);
  return `msg_${timestamp}_${cryptoRandom}`;
}

/**
 * 协议消息检测
 */
export function isProtocolMessage(content) {
  if (!content || typeof content !== 'string') return false;
  return PROTOCOL_PREFIXES.some(p => content.startsWith(p)) || content.trim() === 'hb';
}

export default {
  MessageSchema,
  MESSAGE_TYPES,
  CHANNELS,
  validateMessage,
  createMessage,
  generateMessageId,
  isProtocolMessage,
};
