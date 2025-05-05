module.exports = {
    apps: [
        {
            name: 'device-tracker',
            script: './app.js',
            instances: 1,
            exec_mode: 'fork',
            watch: false,
            autorestart: true,
            max_memory_restart: '200M',
            env: {
                NODE_ENV: 'production',
            },
            // Improved logging configuration
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            error_file: 'logs/error.log',
            out_file: 'logs/output.log',
            merge_logs: true,
            // Set log rotation
            log_type: 'json',
            max_logs: '10d',

            // Improved restart behavior
            restart_delay: 3000,
            min_uptime: '10s',
            max_restarts: 10,

            // Ensure app has time to handle shutdown signals
            kill_timeout: 5000,
            wait_ready: true,

            // Print timestamp in logs
            time: true,

            // Health monitoring with auto-recovery
            exp_backoff_restart_delay: 100,

            // Start monitor app on system startup
            listen_timeout: 8000,
        },
    ],
};
