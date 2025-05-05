const DeviceSession = require('../models/DeviceSession');
const routerUtils = require('./routerUtils');
const emailUtils = require('./emailUtils');
require('dotenv').config();

// Keep track of the current device status
let isDeviceOnline = false;
let currentSession = null;
let lastCheckTime = null;
let consecutiveChecks = 0;

/**
 * Check the device status and update session records
 */
async function checkAndUpdateDeviceStatus() {
    try {
        console.log('Checking device status...');
        const deviceName = process.env.TARGET_DEVICE_NAME;
        const macAddress = process.env.TARGET_MAC;

        const now = new Date();
        lastCheckTime = now;

        // Get the current device status from the router
        const isCurrentlyOnline = await routerUtils.checkDeviceStatus();

        // Device just came online
        if (isCurrentlyOnline && !isDeviceOnline) {
            // To avoid false positives, require 2 consecutive checks
            consecutiveChecks++;

            if (consecutiveChecks >= 2) {
                console.log(`${deviceName} came ONLINE at ${now.toLocaleString()}`);

                // Create a new session
                currentSession = new DeviceSession({
                    macAddress: macAddress,
                    deviceName: deviceName,
                    onlineTime: now,
                });

                // Save the new session
                await currentSession.save();

                // Send email notification
                await emailUtils.sendOnlineNotification(deviceName);

                // Update the device status
                isDeviceOnline = true;
                consecutiveChecks = 0;
            } else {
                console.log(`Detected possible online status. Confirming on next check...`);
            }
        }
        // Device just went offline
        else if (!isCurrentlyOnline && isDeviceOnline) {
            // To avoid false negatives, require 2 consecutive checks
            consecutiveChecks++;

            if (consecutiveChecks >= 2) {
                console.log(`${deviceName} went OFFLINE at ${now.toLocaleString()}`);

                if (currentSession) {
                    // End the current session
                    currentSession.endSession();

                    // Save the updated session
                    await currentSession.save();

                    // Send email notification
                    await emailUtils.sendOfflineNotification(deviceName, currentSession.onlineTime, currentSession.duration);

                    // Reset the current session
                    currentSession = null;
                }

                // Update the device status
                isDeviceOnline = false;
                consecutiveChecks = 0;
            } else {
                console.log(`Detected possible offline status. Confirming on next check...`);
            }
        } else {
            // Status is consistent, reset counter
            consecutiveChecks = 0;
        }

        console.log(`Current device status: ${isDeviceOnline ? 'ONLINE' : 'OFFLINE'}`);
        return isDeviceOnline;
    } catch (error) {
        console.error('Error updating device status:', error);
        return isDeviceOnline;
    }
}

/**
 * Get all sessions for a specific day
 * @param {Date} date - The date to get sessions for
 * @returns {Promise<Array>} Array of sessions for the specified day
 */
async function getSessionsForDay(date = new Date()) {
    // Set time to 00:00:00 for the start of the day
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    // Set time to 23:59:59 for the end of the day
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    try {
        const sessions = await DeviceSession.find({
            onlineTime: { $gte: startOfDay, $lte: endOfDay },
        }).sort({ onlineTime: 1 });

        return sessions;
    } catch (error) {
        console.error('Error fetching sessions for day:', error);
        return [];
    }
}

/**
 * Calculate the total online time for a specific day
 * @param {Date} date - The date to calculate total time for
 * @returns {Promise<number>} Total online time in minutes
 */
async function getTotalOnlineTimeForDay(date = new Date()) {
    try {
        const sessions = await getSessionsForDay(date);

        // Calculate total duration
        let totalMinutes = 0;

        for (const session of sessions) {
            // If the session is still active, calculate duration until now
            if (session.isActive) {
                const now = new Date();
                const durationMs = now - session.onlineTime;
                totalMinutes += Math.floor(durationMs / (1000 * 60));
            } else {
                totalMinutes += session.duration;
            }
        }

        return totalMinutes;
    } catch (error) {
        console.error('Error calculating total online time:', error);
        return 0;
    }
}

/**
 * Send a daily summary email with all sessions and total time
 */
async function sendDailySummary() {
    try {
        // Get yesterday's date
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        // Get all sessions for yesterday
        const sessions = await getSessionsForDay(yesterday);

        // Calculate total online time
        const totalMinutes = await getTotalOnlineTimeForDay(yesterday);

        // Send the daily summary email
        await emailUtils.sendDailySummaryEmail(sessions, totalMinutes);

        console.log(`Daily summary sent for ${yesterday.toLocaleDateString()}`);
    } catch (error) {
        console.error('Error sending daily summary:', error);
    }
}

/**
 * Initialize the device tracker
 * - Sets up the initial device status
 * - Handles any active sessions from previous runs
 */
async function initialize() {
    try {
        // Check if there are any active sessions from previous runs
        const activeSessions = await DeviceSession.find({ isActive: true });

        // If there are active sessions, end them
        if (activeSessions.length > 0) {
            console.log(`Found ${activeSessions.length} active sessions from previous runs. Ending them...`);

            for (const session of activeSessions) {
                session.endSession();
                await session.save();
                console.log(`Ended session that started at ${session.onlineTime.toLocaleString()}`);
            }
        }

        // Get the initial device status
        isDeviceOnline = await routerUtils.checkDeviceStatus();
        console.log(`Initial device status: ${isDeviceOnline ? 'ONLINE' : 'OFFLINE'}`);

        // If the device is already online, create a new session
        if (isDeviceOnline) {
            const deviceName = process.env.TARGET_DEVICE_NAME;
            const macAddress = process.env.TARGET_MAC;

            currentSession = new DeviceSession({
                macAddress: macAddress,
                deviceName: deviceName,
                onlineTime: new Date(),
            });

            await currentSession.save();
            console.log(`Created a new session for currently online device at ${new Date().toLocaleString()}`);
        }

        console.log('Device tracker initialized successfully');
    } catch (error) {
        console.error('Error initializing device tracker:', error);
    }
}

module.exports = {
    checkAndUpdateDeviceStatus,
    getSessionsForDay,
    getTotalOnlineTimeForDay,
    sendDailySummary,
    initialize,
};
