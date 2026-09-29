module.exports = {
  apps: [
    {
      name: 'matchday-bot',
      script: 'src/index.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      time: true,
      env: { NODE_ENV: 'production' },
    },
  ],
};
