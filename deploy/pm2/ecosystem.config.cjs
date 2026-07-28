'use strict';

const API_ROOT = '/opt/HuayueLife-MVP/apps/api';

module.exports = {
  apps: [
    {
      name: 'huayue-api',
      cwd: API_ROOT,
      script: `${API_ROOT}/dist/src/main.js`,
      interpreter: '/usr/bin/node',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
