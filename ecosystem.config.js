module.exports = {
  apps: [{
    name: 'treadmagotchi',
    script: 'node_modules/.bin/next',
    args: 'start',
    cwd: __dirname,
    instances: 1, // NEVER use cluster mode — duplicate engines submit duplicate trades
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      HOSTNAME: '127.0.0.1', // Bind to localhost only
    },
    max_memory_restart: '750M',
    exp_backoff_restart_delay: 1000,
    kill_timeout: 10000, // 10s for graceful shutdown during active trading loop
  }],
};
