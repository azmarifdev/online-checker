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
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            error_file: 'logs/error.log',
            out_file: 'logs/output.log',
            merge_logs: true,
        },
    ],
};
