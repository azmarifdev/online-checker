const express = require('express');
const path = require('path');
const CronJob = require('cron').CronJob;
const connectDB = require('./config/database');
const deviceTracker = require('./utils/deviceTracker');
const expressLayouts = require('express-ejs-layouts');
require('dotenv').config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Connect to MongoDB
connectDB();

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Set static folder
app.use(express.static(path.join(__dirname, 'public')));

// EJS setup
app.use(expressLayouts);
app.set('layout', 'layout');
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Add title to res.locals for all requests to ensure it's available in layout
app.use((req, res, next) => {
    res.locals.title = 'Device Tracker'; // Default title
    next();
});

// Routes
app.use('/', require('./routes/index'));
app.use('/api', require('./routes/api'));

// Monitoring state variables
let monitoringActive = false;
let pollingInterval = parseInt(process.env.POLLING_INTERVAL, 10) || 30000; // Default to 30 seconds
let pollingTimer = null;
const MIN_POLLING_INTERVAL = 10000; // 10 seconds minimum
const MAX_POLLING_INTERVAL = 60000; // 60 seconds maximum
const ADAPTIVE_POLLING = process.env.ADAPTIVE_POLLING !== 'false'; // Enable adaptive polling by default

/**
 * Start device status monitoring with improved reliability
 */
async function startMonitoring() {
    if (monitoringActive) return; // Already monitoring

    try {
        // Initialize the device tracker
        await deviceTracker.initialize();
        console.log('Device tracker initialized');
        monitoringActive = true;

        // Schedule the first check immediately
        scheduleNextCheck();

        // Set up daily summary email at 00:01
        const dailySummaryJob = new CronJob('1 0 * * *', async function () {
            console.log('Running daily summary job');
            try {
                await deviceTracker.sendDailySummary();
            } catch (error) {
                console.error('Error in daily summary job:', error);
            }
        });

        dailySummaryJob.start();
        console.log('Daily summary job scheduled for 00:01');
    } catch (error) {
        console.error('Error initializing monitoring:', error);
        console.log('Retrying initialization in 30 seconds...');
        // Retry initialization after a delay
        setTimeout(startMonitoring, 30000);
    }
}

/**
 * Schedule the next status check with adaptive interval
 */
function scheduleNextCheck() {
    if (!monitoringActive) return;

    // Clear any existing timer
    if (pollingTimer) {
        clearTimeout(pollingTimer);
    }

    // Schedule the next check
    pollingTimer = setTimeout(async () => {
        try {
            // Perform the status check
            const isOnline = await deviceTracker.checkAndUpdateDeviceStatus();

            // Adjust polling interval if adaptive polling is enabled
            if (ADAPTIVE_POLLING) {
                adjustPollingInterval(isOnline);
            }
        } catch (error) {
            console.error('Error in device status check:', error);
        }

        // Schedule the next check
        scheduleNextCheck();
    }, pollingInterval);
}

/**
 * Adjust polling interval based on device status
 * @param {boolean} isOnline - Current device status
 */
function adjustPollingInterval(isOnline) {
    const baseInterval = parseInt(process.env.POLLING_INTERVAL, 10) || 30000;

    if (isOnline) {
        // When device is online, poll more frequently (80% of base interval but not less than minimum)
        pollingInterval = Math.max(Math.floor(baseInterval * 0.8), MIN_POLLING_INTERVAL);
    } else {
        // When device is offline, we can poll less frequently (120% of base interval but not more than maximum)
        pollingInterval = Math.min(Math.floor(baseInterval * 1.2), MAX_POLLING_INTERVAL);
    }

    console.log(`Adjusted polling interval: ${pollingInterval}ms (${pollingInterval / 1000} seconds)`);
}

/**
 * Stop monitoring
 */
function stopMonitoring() {
    monitoringActive = false;
    if (pollingTimer) {
        clearTimeout(pollingTimer);
        pollingTimer = null;
    }
}

// Initialize the device tracker and start monitoring
startMonitoring();

// Handle errors
app.use((req, res, next) => {
    res.status(404).render('error', {
        title: 'Page Not Found',
        message: 'Page Not Found',
        error: { status: 404 },
    });
});

app.use((err, req, res, next) => {
    res.status(err.status || 500).render('error', {
        title: 'Error',
        message: err.message,
        error: process.env.NODE_ENV === 'development' ? err : {},
    });
});

// Start the server
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Handle server shutdown gracefully
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        stopMonitoring();
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        stopMonitoring();
        process.exit(0);
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    // Continue running, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Continue running, just log the error
});
