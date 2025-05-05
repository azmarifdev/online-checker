const DeviceSession = require('../models/DeviceSession');
const deviceTracker = require('../utils/deviceTracker');
const moment = require('moment');

/**
 * Get the current status of the target device
 */
async function getCurrentStatus(req, res) {
    try {
        // Check if there's an active session
        const activeSession = await DeviceSession.findOne({ isActive: true });

        // Calculate current session duration if online
        let currentDuration = 0;
        if (activeSession) {
            const now = new Date();
            const durationMs = now - activeSession.onlineTime;
            currentDuration = Math.floor(durationMs / (1000 * 60)); // Convert to minutes
        }

        // Get today's total time
        const todayTotal = await deviceTracker.getTotalOnlineTimeForDay();

        res.json({
            isOnline: !!activeSession,
            currentSession: activeSession
                ? {
                      onlineTime: activeSession.onlineTime,
                      duration: currentDuration,
                  }
                : null,
            todayTotal: todayTotal,
        });
    } catch (error) {
        console.error('Error fetching current status:', error);
        res.status(500).json({ error: 'Failed to fetch current status' });
    }
}

/**
 * Get sessions for a specific day
 */
async function getDailySessions(req, res) {
    try {
        const { date } = req.query;
        let targetDate;

        if (date) {
            // Parse the date from query parameter
            targetDate = new Date(date);
        } else {
            // Default to today
            targetDate = new Date();
        }

        // Check if the date is valid
        if (isNaN(targetDate.getTime())) {
            return res.status(400).json({ error: 'Invalid date format' });
        }

        // Get sessions for the specified day
        const sessions = await deviceTracker.getSessionsForDay(targetDate);

        // Calculate total online time
        const totalMinutes = await deviceTracker.getTotalOnlineTimeForDay(targetDate);

        // Format sessions for display
        const formattedSessions = sessions.map((session) => {
            return {
                id: session._id,
                onlineTime: session.onlineTime,
                offlineTime: session.offlineTime || null,
                duration: session.duration,
                isActive: session.isActive,
            };
        });

        res.json({
            date: targetDate.toISOString().split('T')[0],
            sessions: formattedSessions,
            totalMinutes: totalMinutes,
        });
    } catch (error) {
        console.error('Error fetching daily sessions:', error);
        res.status(500).json({ error: 'Failed to fetch sessions' });
    }
}

/**
 * Get sessions within a date range
 */
async function getRangeSessions(req, res) {
    try {
        const { startDate, endDate } = req.query;

        // Parse dates from query parameters
        const start = startDate ? new Date(startDate) : new Date();
        start.setHours(0, 0, 0, 0);

        const end = endDate ? new Date(endDate) : new Date();
        end.setHours(23, 59, 59, 999);

        // Check if the dates are valid
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({ error: 'Invalid date format' });
        }

        // Get all sessions within the date range
        const sessions = await DeviceSession.find({
            onlineTime: { $gte: start, $lte: end },
        }).sort({ onlineTime: 1 });

        // Group sessions by date
        const groupedSessions = {};
        let totalMinutesInRange = 0;

        for (const session of sessions) {
            // Format the date as YYYY-MM-DD
            const dateKey = moment(session.onlineTime).format('YYYY-MM-DD');

            // Initialize the array if it doesn't exist
            if (!groupedSessions[dateKey]) {
                groupedSessions[dateKey] = {
                    sessions: [],
                    totalMinutes: 0,
                };
            }

            // Add session to the array
            groupedSessions[dateKey].sessions.push({
                id: session._id,
                onlineTime: session.onlineTime,
                offlineTime: session.offlineTime || null,
                duration: session.duration,
                isActive: session.isActive,
            });

            // Add to the daily total
            groupedSessions[dateKey].totalMinutes += session.isActive
                ? Math.floor((new Date() - session.onlineTime) / (1000 * 60))
                : session.duration;

            // Add to the overall total
            totalMinutesInRange += session.isActive
                ? Math.floor((new Date() - session.onlineTime) / (1000 * 60))
                : session.duration;
        }

        res.json({
            startDate: start.toISOString().split('T')[0],
            endDate: end.toISOString().split('T')[0],
            dailySessions: groupedSessions,
            totalMinutesInRange,
        });
    } catch (error) {
        console.error('Error fetching range sessions:', error);
        res.status(500).json({ error: 'Failed to fetch sessions' });
    }
}

module.exports = {
    getCurrentStatus,
    getDailySessions,
    getRangeSessions,
};
