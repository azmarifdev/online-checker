const express = require('express');
const router = express.Router();
const deviceTracker = require('../utils/deviceTracker');
const DeviceSession = require('../models/DeviceSession');
const moment = require('moment');

// Home page / Dashboard
router.get('/', async (req, res) => {
    try {
        // Get current device status
        const activeSession = await DeviceSession.findOne({ isActive: true });

        // Get today's sessions
        const today = new Date();
        const sessions = await deviceTracker.getSessionsForDay(today);

        // Calculate today's total time
        const totalMinutes = await deviceTracker.getTotalOnlineTimeForDay(today);

        // Format the total time
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const totalTimeFormatted = `${hours}h ${minutes}m`;

        // Check if the device is currently online
        const isOnline = !!activeSession;

        // Calculate current session duration if online
        let currentDuration = '';
        if (activeSession) {
            const now = new Date();
            const durationMs = now - activeSession.onlineTime;
            const durationMinutes = Math.floor(durationMs / (1000 * 60));
            const currentHours = Math.floor(durationMinutes / 60);
            const currentMins = durationMinutes % 60;
            currentDuration = `${currentHours}h ${currentMins}m`;
        }

        res.render('index', {
            title: 'Device Tracker',
            deviceName: process.env.TARGET_DEVICE_NAME,
            isOnline,
            currentSession: activeSession
                ? {
                      onlineTime: moment(activeSession.onlineTime).format('YYYY-MM-DD HH:mm:ss'),
                      duration: currentDuration,
                  }
                : null,
            todaySessions: sessions.map((session) => ({
                onlineTime: moment(session.onlineTime).format('YYYY-MM-DD HH:mm:ss'),
                offlineTime: session.offlineTime
                    ? moment(session.offlineTime).format('YYYY-MM-DD HH:mm:ss')
                    : 'Still Online',
                duration: session.duration ? `${Math.floor(session.duration / 60)}h ${session.duration % 60}m` : 'N/A',
                isActive: session.isActive,
            })),
            totalSessions: sessions.length,
            totalTime: totalTimeFormatted,
        });
    } catch (error) {
        console.error('Error rendering dashboard:', error);
        res.status(500).render('error', {
            message: 'Failed to load dashboard',
            error,
        });
    }
});

// History page - show previous days
router.get('/history', async (req, res) => {
    try {
        // Get date from query or use today's date
        const dateParam = req.query.date;
        const targetDate = dateParam ? new Date(dateParam) : new Date();

        // Check if the date is valid
        if (isNaN(targetDate.getTime())) {
            return res.status(400).render('error', {
                message: 'Invalid date format',
                error: { status: 400 },
            });
        }

        // Get sessions for the specified day
        const sessions = await deviceTracker.getSessionsForDay(targetDate);

        // Calculate total online time
        const totalMinutes = await deviceTracker.getTotalOnlineTimeForDay(targetDate);

        // Format the total time
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const totalTimeFormatted = `${hours}h ${minutes}m`;

        res.render('history', {
            title: 'Session History',
            deviceName: process.env.TARGET_DEVICE_NAME,
            date: moment(targetDate).format('YYYY-MM-DD'),
            sessions: sessions.map((session) => ({
                onlineTime: moment(session.onlineTime).format('YYYY-MM-DD HH:mm:ss'),
                offlineTime: session.offlineTime
                    ? moment(session.offlineTime).format('YYYY-MM-DD HH:mm:ss')
                    : 'Still Online',
                duration: session.duration ? `${Math.floor(session.duration / 60)}h ${session.duration % 60}m` : 'N/A',
                isActive: session.isActive,
            })),
            totalSessions: sessions.length,
            totalTime: totalTimeFormatted,
            previousDay: moment(targetDate).subtract(1, 'day').format('YYYY-MM-DD'),
            nextDay: moment(targetDate).add(1, 'day').format('YYYY-MM-DD'),
            isToday: moment(targetDate).isSame(new Date(), 'day'),
        });
    } catch (error) {
        console.error('Error rendering history page:', error);
        res.status(500).render('error', {
            message: 'Failed to load history page',
            error,
        });
    }
});

module.exports = router;
