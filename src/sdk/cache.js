/**
 * 本地缓存模块 — 减少重复 token 消耗
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';

const CACHE_DIR = 'D:/BKS/projects/team-workspace/.cache';
const DEFAULT_TTL = 30 * 60 * 1000;

if (!existsSync(CACHE_DIR)) {
  mkdirSync(CACHE_DIR, { recursive: true });
}

export function setCache(key, data, ttl = DEFAULT_TTL) {
  const filePath = join(CACHE_DIR, `${key}.json`);
  writeFileSync(filePath, JSON.stringify({ data, expires: Date.now() + ttl }), 'utf8');
}

export function getCache(key) {
  const filePath = join(CACHE_DIR, `${key}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const entry = JSON.parse(readFileSync(filePath, 'utf8'));
    if (Date.now() > entry.expires) { unlinkSync(filePath); return null; }
    return entry.data;
  } catch { return null; }
}

export function cleanCache() {
  try {
    for (const f of readdirSync(CACHE_DIR)) {
      if (!f.endsWith('.json')) continue;
      const fp = join(CACHE_DIR, f);
      try {
        if (Date.now() > JSON.parse(readFileSync(fp, 'utf8')).expires) unlinkSync(fp);
      } catch { unlinkSync(fp); }
    }
  } catch {}
}

cleanCache();
setInterval(cleanCache, 10 * 60 * 1000);
