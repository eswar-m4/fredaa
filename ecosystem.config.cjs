'use strict';
module.exports = {
  apps: [
    {
      name: 'freda-customer',
      script: './start-nitro.mjs',
      cwd: '.',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        PORT: '8132',
        HOST: '127.0.0.1',
        NODE_ENV: 'production',
      },
    },
  ],
};
