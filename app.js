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

// Initialize the device tracker
(async () => {
    try {
        await deviceTracker.initialize();
        console.log('Device tracker initialized');

        // Set up periodic checking
        const pollingInterval = parseInt(process.env.POLLING_INTERVAL, 10) || 30000; // Default to 30 seconds

        setInterval(async () => {
            await deviceTracker.checkAndUpdateDeviceStatus();
        }, pollingInterval);

        console.log(`Status checking started with ${pollingInterval / 1000} second intervals`);

        // Set up daily summary email at 00:01
        const dailySummaryJob = new CronJob('1 0 * * *', async function () {
            console.log('Running daily summary job');
            await deviceTracker.sendDailySummary();
        });

        dailySummaryJob.start();
        console.log('Daily summary job scheduled for 00:01');
    } catch (error) {
        console.error('Error initializing the application:', error);
    }
})();

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
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
