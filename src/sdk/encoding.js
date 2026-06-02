/**
 * 编码工具 — 检测和修复乱码
 */

/**
 * 检测文本是否包含乱码
 * @param {string} text - 要检测的文本
 * @returns {boolean} - 是否包含乱码
 */
export function hasGarbledText(text) {
  if (!text) return false;

  // 检测连续问号（通常是编码损坏的标志）
  if (/\?{3,}/.test(text)) return true;

  // 检测控制字符（除了常见的换行、制表符）
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text)) return true;

  // 检测 UTF-8 编码损坏的字节序列
  // 这些是无效的 UTF-8 序列的常见模式
  if (/[�￾￿]/.test(text)) return true;

  return false;
}

/**
 * 清理乱码文本
 * @param {string} text - 要清理的文本
 * @returns {string} - 清理后的文本
 */
export function cleanGarbledText(text) {
  if (!text) return '';

  // 移除控制字符（保留换行、制表符）
  let cleaned = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  // 移除 Unicode 替换字符
  cleaned = cleaned.replace(/[�￾￿]/g, '');

  // 移除连续问号（但保留单个问号）
  cleaned = cleaned.replace(/\?{3,}/g, '');

  // 清理多余的空白
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}

/**
 * 验证和修复文本编码
 * @param {string} text - 要验证的文本
 * @returns {{ valid: boolean, cleaned: string, original: string }}
 */
export function validateEncoding(text) {
  const original = text;
  const cleaned = cleanGarbledText(text);
  const valid = !hasGarbledText(cleaned) && cleaned.length > 0;

  return { valid, cleaned, original };
}
