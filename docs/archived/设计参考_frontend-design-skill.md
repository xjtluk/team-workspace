# Frontend-Design Skill 参考 — 团队工作室像素风

> 2026-05-31 | 小马整理，供 CC P1 阶段参考

## 核心设计方向

根据 frontend-design skill 指导，团队工作室应走 **"像素复古 + 暗色工业"** 路线：
- 色调：不纯黑，使用暗色 tint（`#0D0E15` 基底，微微偏橙棕）
- 反差：像素角色高饱和 vs 背景低明度，保证角色在前景突出
- 字体：Press Start 2P（已选定）

## 可直接复用的模式

### 1. 暗色像素基底 CSS

```css
:root {
  --bg-deep: #0D0E15;
  --bg-panel: #14161F;
  --bg-surface: #1A1D28;
  --text-primary: #D4C5B9;
  --text-secondary: #8A7E72;
  --accent-orange: #E88D2A;
  --accent-brown: #8B4513;
  --accent-gold: #D4A84B;
  --border-dim: #2A2D38;
  --shadow-crt: 0 0 4px rgba(232, 141, 42, 0.08);
  --font-pixel: 'Press Start 2P', monospace;
}

/* CRT overlay — 避免纯 CSS 渐变，用 repeating-linear-gradient */
.crt-overlay::after {
  content: '';
  position: fixed; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(
    0deg,
    transparent, transparent 2px,
    rgba(0, 0, 0, 0.04) 2px, rgba(0, 0, 0, 0.04) 4px
  );
  z-index: 9999;
}
```

### 2. 分隔替代方案（skill 强调：不用 thick dark borders）

```css
/* 用背景色差代替边框 */
.chat-panel { background: var(--bg-panel); }
.office-canvas { background: var(--bg-deep); }

/* 用 box-shadow 代替分隔线 */
.message-item + .message-item {
  box-shadow: 0 -1px 0 var(--border-dim);
}
```

### 3. 角色状态动画（motion-design 参考）

- 使用 `transform` + `opacity`（不触发 layout）
- 使用 `cubic-bezier` 指数缓出，不用 bounce/elastic
- 动画时长：idle 2s / working 0.8s / talking 0.3s / error 0.15s
- 所有动画加 `@media (prefers-reduced-motion)` 降级

### 4. 所有交互元素五态（polish checklist）

每个可交互的 UI 元素：default / hover / active / focus / disabled。
群聊输入框、发送按钮、消息气泡都必须覆盖。

### 5. AI Slop 自查清单

- ❌ 不用 cyan-on-dark 配色
- ❌ 不用 purple-to-blue gradients
- ❌ 不用 glassmorphism
- ❌ 不用 cards 嵌套 cards
- ✅ 用 tinted neutrals（所有灰色微微偏棕）
- ✅ 用 box-shadow 替代 borders
- ✅ 像素角色高饱和 vs 背景低明度对比

---

## 参考文档索引（skill 内置）

| 参考 | 路径 |
|------|------|
| 字体量表 | `reference/typography.md` |
| OKLCH 配色 | `reference/color-and-contrast.md` |
| 空间网格 | `reference/spatial-design.md` |
| 动画缓动 | `reference/motion-design.md` |
| 细节打磨 | `reference/design-details.md` |