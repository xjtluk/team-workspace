module.exports = {
  apps: [
    {
      name: 'workspace-server',
      script: 'server/index.js',
      cwd: 'D:/BKS/projects/team-workspace',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 10000,
      watch: false,
      max_memory_restart: '200M',
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        PORT: 3210
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/server-error.log',
      out_file: './logs/server-out.log',
      merge_logs: true
    },
    {
      name: 'cc-listener',
      script: 'start-cc.mjs',
      cwd: 'D:/BKS/projects/team-workspace',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 10000,
      watch: false,
      max_memory_restart: '200M',
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production'
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/cc-listener-error.log',
      out_file: './logs/cc-listener-out.log',
      merge_logs: true
    },
    {
      name: 'xiaoma-listener',
      script: 'start-xiaoma.mjs',
      cwd: 'D:/BKS/projects/team-workspace',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 10000,
      watch: false,
      max_memory_restart: '200M',
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production'
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/xiaoma-listener-error.log',
      out_file: './logs/xiaoma-listener-out.log',
      merge_logs: true
    },
    {
      name: 'cx-listener',
      script: 'start-cx.mjs',
      cwd: 'D:/BKS/projects/team-workspace',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 10000,
      watch: false,
      max_memory_restart: '200M',
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production'
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/cx-listener-error.log',
      out_file: './logs/cx-listener-out.log',
      merge_logs: true
    }
  ]
};
