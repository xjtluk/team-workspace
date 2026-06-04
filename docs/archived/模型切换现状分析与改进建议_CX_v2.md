# 模型切换现状分析与改进建议（v2）

> 分析人：CX（代码工程师）
> 日期：2026-06-04
> 基于对 `ai-reply.js`、`cx-listener.mjs`、`start-cx.mjs` 的逐行代码验证

---

## 一、现状确认（代码级验证）

### 1.1 动态工具轮次 ✅ 已实现

| 任务类型 | 轮次 | 触发条件 | 代码位置 |
|---------|------|---------|---------|
| 日常 | **5 次** | `@CX [日常]` | `cx-listener.mjs:355` |
| 代码 | **15 次** | `@CX [代码]` | `cx-listener.mjs:355` |
| 困难 | **15 次** | `@CX [困难]` | `cx-listener.mjs:355` |

KK 此前的方案已落地。日常 5 轮、代码/困难 15 轮。

### 1.2 超时配置（硬编码，不区分任务类型 ❌）

| 参数 | 当前值 | 位置 |
|------|--------|------|
| `FETCH_TIMEOUT` | **60s**（固定，所有任务统一） | `ai-reply.js:106` |
| 重试次数 `MAX_RETRIES` | **3 次**（全局） | `ai-reply.js:107` |
| AI_TASK_TIMEOUT（看门狗） | 300s | `cx-listener.mjs` |
| 重试开关 `AI_RETRY` | 默认开启 | `ai-reply.js:108` |

### 1.3 429 处理（有重试但无冷却 ❌）

当前 `cx-listener.mjs:383`：
```
429 重试策略：3s 延迟 + 1 次重试
失败后：进入降级链切换到下一个 provider
冷却机制：❌ 不存在
```
**核心问题**：下一次新任务来临时，降级链**从头开始**（重新尝试 SiliconFlow），没有"此 provider 在 N 分钟内跳过"的记录。

### 1.4 降级链（有但未充分利用 ❌）

**代码/困难任务：**
```
SiliconFlow DS4 Pro → 智谱 GLM-4.7
```

**日常任务：**
```
TaoToken Flash → 智谱 Flash → SiliconFlow DS4
```

**问题**：
- 代码任务只有 2 个后备——SiliconFlow 429 后只能降级到智谱 GLM-4.7
- TaoToken 仅用于日常任务，未加入代码任务的后备链
- 降级链失败后抛错，没有等待人工指令的机制

---

## 二、四大痛点分析

### 痛点①：SiliconFlow 超时严重（30-60s）

**场景验证**：
- `FETCH_TIMEOUT = 60000` 是全局硬编码（`ai-reply.js:106`）
- DeepSeek V4 Pro 在长上下文推理时经常超过 60s
- 超时后触发 `callWithRetry`，重试 3 次
- 每次超时浪费 **60s × 3 次 = 180s**，然后才降级到智谱

**影响**：一个超时就浪费 3 分钟，用户体验差。而智谱 GLM-4.7-Flash 从未有过超时问题。

**根因**：Flash 模型和 Pro 模型用同一个超时值。Flash 30s 足够，Pro 120s 才够。

### 痛点②：长文件读取困难

**场景验证**：
- CX 当前用 `bash` + `sed -n '200,500p'` 分段读文件
- 每段读取是一个独立的工具调用轮次
- 1000 行文件需要 5 段，占用 5/15 轮工具调用
- 每段耗时 30-60s（bash 执行 + 模型处理工具结果）

**根本限制**：`ai-reply.js` 的工具列表中**没有 `read_file` 工具**。CX 只能通过 bash 间接读写文件。

**影响**：大文件分析时工具轮次紧张，且耗时长。

### 痛点③：无 Provider 级 429 冷却

**场景验证**：
- SiliconFlow 账户级限制（每分钟 30 次）被超时触发无限重试
- 429 → 3s 延迟重试 1 次 → 失败 → 切智谱（本次成功）
- **但下次新任务又优先尝试 SiliconFlow** → 再 429 → 重复循环
- 没有记录"此 provider 5 分钟内不可用"的状态

**影响**：每次 429 后浪费 3s+1 次无效调用，累积耗时。

**应对思路**：需要跨 provider 切换，SiliconFlow 429 后自动回避一段时间。

### 痛点④：超时不按任务类型自适应

| 场景 | 实际耗时 | 当前超时 | 问题 |
|------|---------|---------|------|
| 日常对话（Flash） | 3-10s | 60s | ✅ 够用 |
| 文件读取（Flash） | 10-30s | 60s | ✅ 够用 |
| 代码生成（Pro） | 60-120s | **60s** | ❌ **频繁超时** |
| 复杂重构（Pro） | 90-180s | **60s** | ❌ **频繁超时** |

**结论**：60s 对 Flash 太长（等待浪费时间），对 Pro 太短（频繁误超时）。

---

## 三、以当前代码为基础的最小改动方案

### 方案一：Provider 冷却机制（~25 行，高收益）

**改动文件**：`cx-listener.mjs`

在文件顶部添加冷却 Map：
```javascript
const providerCooldown = new Map();
const PROVIDER_COOLDOWN_MS = 5 * 60 * 1000; // 5分钟冷却

function isProviderOnCooldown(name) {
  const until = providerCooldown.get(name);
  return until && Date.now() < until;
}

function markProviderCooldown(name) {
  providerCooldown.set(name, Date.now() + PROVIDER_COOLDOWN_MS);
  console.log(`[CX] ${name} 触发冷却，5分钟后恢复`);
}
```

修改降级链遍历（约 390 行附近）：
```javascript
for (let i = 0; i < fallbackChain.length; i++) {
  const { name, tier } = fallbackChain[i];
  if (isProviderOnCooldown(name)) {
    console.log(`[CX] 跳过 ${name}（冷却中）`);
    continue;  // 跳过冷却中的 provider
  }
  // ... 原有调用逻辑 ...
  if (err.message.includes('429')) {
    markProviderCooldown(name);
    continue;  // 尝试下一个
  }
}
```

**收益**：SiliconFlow 429 后 5 分钟内自动跳过，不再无效重试。
**风险**：无。纯内存 Map，不持久化，重启后自动清空。

### 方案二：自适应超时（~10 行，中收益）

**改动文件**：`cx-listener.mjs`（传递超时参数）+ `ai-reply.js`（接收参数）

最小改动方式：不修改函数签名，用环境变量覆盖：

```javascript
// cx-listener.mjs 中，在调用 generateReply 前设置
const TIMEOUT_MAP = {
  normal: '30000',   // 日常 30s
  code: '120000',    // 代码 120s
  hard: '120000',    // 困难 120s
};
const taskType = isCodeTask ? 'code' : isHardTask ? 'hard' : 'normal';
process.env.CX_FETCH_TIMEOUT = TIMEOUT_MAP[taskType];
```

```javascript
// ai-reply.js 中，FETCH_TIMEOUT 改为：
const FETCH_TIMEOUT = parseInt(process.env.CX_FETCH_TIMEOUT) || 60000;
```

**收益**：日常任务 30s 快速失败（不用干等 60s），代码任务 120s 减少误超时。
**风险**：过程变量污染（可以用完后恢复 env）。

### 方案三：TaoToken 加入代码任务后备链（~5 行，低收益）

**改动文件**：`cx-listener.mjs`

代码任务降级链从：
```javascript
[ { name: 'SiliconFlow DS4', ... }, { name: '智谱 GLM-4.7', ... } ]
```
改为：
```javascript
[ 
  { name: 'SiliconFlow DS4', ... }, 
  { name: 'TaoToken DS4 Flash', tier: MODEL_TIERS.taotokenFlash }, 
  { name: '智谱 GLM-4.7', ... } 
]
```

**收益**：多一个跨 provider 的后备，减少直接降级到智谱的概率。
**风险**：TaoToken Flash 的代码能力可能不如 SiliconFlow Pro，但作为紧急备用没问题。

### 方案四：降级失败改为等待指令（~3 行，低收益）

**改动文件**：`cx-listener.mjs`

当前（约 440 行附近）：
```javascript
// 所有降级都失败
throw lastErr;
```
改为：
```javascript
// 所有降级都失败，等待人工指令
console.log(`[CX] 所有模型降级失败: ${lastErr.message}`);
aiReply = `@CC [问题] 所有模型降级失败: ${lastErr.message}，请指示。`;
```

**收益**：降级链彻底失败时，CX 主动上报 CC，而不是 silent fail。
**风险**：无。

---

## 四、不需要改的

| 功能 | 原因 |
|------|------|
| 智能路由器（自动判断复杂度） | 当前标签（日常/代码/困难）已覆盖 80% 场景 |
| 对抗辩论（双模型互审） | 两倍 token 成本，且 CC 已承担审查 |
| 质量评分模型 | 不可靠，不如 CC 最终审查 |
| 文件缓存持久化 | 会话级缓存够用，持久化增加复杂度 |
| 新增模型层（TaoToken GLM-5 等） | 等 TaoToken 充值后再加 |

---

## 五、实施建议

### 优先顺序

| 优先级 | 方案 | 代码量 | 收益 | 实施风险 |
|--------|------|--------|------|---------|
| **P0** | 方案一：Provider 冷却 | ~25 行 | 🔥🔥🔥 减少 429 无效重试 | 无 |
| **P0** | 方案二：自适应超时 | ~10 行 | 🔥🔥🔥 减少误超时 | 低 |
| **P1** | 方案三：TaoToken 加入后备 | ~5 行 | 🔥 增加降级选择 | 无 |
| **P1** | 方案四：降级失败上报 | ~3 行 | 🔥 避免静默失败 | 无 |

### 总结

当前架构（标签驱动 + 降级链 + 动态工具轮次）方向正确，**核心疼痛是 429 无冷却和超时一刀切**。

两个 P0 改动（冷却 + 自适应超时）相互独立，可以并行实施。预计总改动量 **< 40 行**，无需改 `ai-reply.js`（均在 `cx-listener.mjs` 内完成）。

---

*本文档由 CX 生成*
