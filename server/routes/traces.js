import { Router } from 'express';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRACES_DIR = join(__dirname, '..', '..', 'traces');

const router = Router();

/**
 * GET /api/traces - 列出所有 trace
 * 可选参数: ?agent=cc&date=2026-06-07&limit=50
 */
router.get('/', (req, res) => {
  try {
    const { agent, date, limit = 50 } = req.query;
    const traces = [];
    
    if (!existsSync(TRACES_DIR)) {
      return res.json({ traces: [], count: 0 });
    }
    
    // 扫描 traces 目录
    const agentDirs = readdirSync(TRACES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory());
    
    for (const agentDir of agentDirs) {
      const agentName = agentDir.name;
      
      // 按 agent 过滤
      if (agent && agent !== agentName) continue;
      
      const agentPath = join(TRACES_DIR, agentName);
      const dateDirs = readdirSync(agentPath, { withFileTypes: true })
        .filter(d => d.isDirectory());
      
      for (const dateDir of dateDirs) {
        const dateName = dateDir.name;
        
        // 按日期过滤
        if (date && date !== dateName) continue;
        
        const datePath = join(agentPath, dateName);
        const traceFiles = readdirSync(datePath)
          .filter(f => f.endsWith('.jsonl'));
        
        for (const traceFile of traceFiles) {
          const tracePath = join(datePath, traceFile);
          try {
            const content = readFileSync(tracePath, 'utf-8').trim();
            if (content) {
              // 读取 JSONL 最后一行作为摘要
              const lines = content.split('\n').filter(l => l.trim());
              if (lines.length > 0) {
                const lastLine = JSON.parse(lines[lines.length - 1]);
                traces.push({
                  id: traceFile.replace('.jsonl', ''),
                  agent: agentName,
                  date: dateName,
                  path: tracePath,
                  events: lines.length,
                  summary: lastLine,
                });
              }
            }
          } catch (e) {
            console.warn(`[Traces] 读取 trace 失败: ${tracePath}: ${e.message}`);
          }
        }
      }
    }
    
    // 按时间倒序排列
    traces.sort((a, b) => {
      const aTime = a.summary?.timestamp || 0;
      const bTime = b.summary?.timestamp || 0;
      return bTime - aTime;
    });
    
    // 限制数量
    const result = traces.slice(0, parseInt(limit));
    res.json({ traces: result, count: result.length });
  } catch (err) {
    console.error('[Traces] 列出 trace 失败:', err.message);
    res.status(500).json({ error: '无法读取 trace' });
  }
});

/**
 * GET /api/traces/:agent/:date/:id - 查看具体 trace 内容
 */
router.get('/:agent/:date/:id', (req, res) => {
  try {
    const { agent, date, id } = req.params;
    const tracePath = join(TRACES_DIR, agent, date, `${id}.jsonl`);
    
    if (!existsSync(tracePath)) {
      return res.status(404).json({ error: 'Trace 不存在' });
    }
    
    const content = readFileSync(tracePath, 'utf-8');
    const events = content.split('\n')
      .filter(l => l.trim())
      .map(l => {
        try { return JSON.parse(l); }
        catch { return { raw: l }; }
      });
    
    res.json({
      id,
      agent,
      date,
      path: tracePath,
      events,
      count: events.length,
    });
  } catch (err) {
    console.error('[Traces] 读取 trace 失败:', err.message);
    res.status(500).json({ error: '无法读取 trace' });
  }
});

/**
 * GET /api/traces/stats - Trace 统计信息
 */
router.get('/stats', (req, res) => {
  try {
    if (!existsSync(TRACES_DIR)) {
      return res.json({ agents: {}, total: 0 });
    }
    
    const stats = {};
    let total = 0;
    
    const agentDirs = readdirSync(TRACES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory());
    
    for (const agentDir of agentDirs) {
      const agentName = agentDir.name;
      const agentPath = join(TRACES_DIR, agentName);
      const dateDirs = readdirSync(agentPath, { withFileTypes: true })
        .filter(d => d.isDirectory());
      
      let agentTotal = 0;
      let agentDates = [];
      
      for (const dateDir of dateDirs) {
        const datePath = join(agentPath, dateDir.name);
        const files = readdirSync(datePath).filter(f => f.endsWith('.jsonl'));
        agentTotal += files.length;
        agentDates.push({ date: dateDir.name, count: files.length });
      }
      
      stats[agentName] = {
        total: agentTotal,
        dates: agentDates,
      };
      total += agentTotal;
    }
    
    res.json({ agents: stats, total });
  } catch (err) {
    console.error('[Traces] 统计失败:', err.message);
    res.status(500).json({ error: '无法统计 trace' });
  }
});

export default router;
