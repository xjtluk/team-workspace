/**
 * Centralized Configuration
 *
 * All hardcoded values consolidated here. Each value reads from
 * environment variables first, falling back to sensible defaults.
 *
 * Usage:
 *   import config from '../config/index.js';
 *   const { proxyUrl } = config;
 */

const config = {
  // ── Proxy ──
  proxy: {
    host: process.env.PROXY_HOST || '127.0.0.1',
    port: process.env.PROXY_PORT || '7897',
    get url() {
      return `http://${this.host}:${this.port}`;
    },
  },

  // ── Paths ──
  paths: {
    projectDir: process.env.PROJECT_DIR || 'D:/BKS/projects/team-workspace',
    teamDir: process.env.TEAM_DIR || 'D:/BKS/team',
    portfolioDir: process.env.PORTFOLIO_DIR || 'D:/BKS/portfolio',
    projectsDir: process.env.PROJECTS_DIR || 'D:/BKS/projects',
  },

  // ── AI Models (sidecar-cx) ──
  models: {
    heavy: {
      model: process.env.CX_MODEL_HEAVY || 'deepseek-v4-pro',
      reasoning: 'high',
    },
    medium: {
      model: process.env.CX_MODEL_MEDIUM || 'deepseek-v4-pro',
      reasoning: 'medium',
    },
    light: {
      model: process.env.CX_MODEL_LIGHT || 'deepseek-v4-flash',
      reasoning: 'low',
    },
  },

  // ── Audit Log ──
  audit: {
    get logPath() {
      return `${config.paths.projectDir}/data/audit.log`;
    },
    get logDir() {
      return `${config.paths.projectDir}/data`;
    },
  },
};

export default config;
