const DeviceSession = require('../models/DeviceSession');
const routerUtils = require('./routerUtils');
const emailUtils = require('./emailUtils');
const pingUtils = require('./pingUtils');
require('dotenv').config();

// Keep track of the current device status
let isDeviceOnline = false;
let currentSession = null;
let lastCheckTime = null;
let consecutiveFalsePositives = 0;
let consecutiveFalseNegatives = 0;
let deviceIP = null; // Will store the device IP if discovered
let lastFoundOnlineTime = null; // Track when the device was last seen online
let knownDeviceIPs = new Set(); // Store multiple known device IPs
let statusHistory = []; // Keep a small history of status checks for better decision making
let initialScanDone = false; // Flag for when we've done a full subnet scan

// Maximum entries in status history
const MAX_HISTORY_SIZE = 5;

// Threshold settings - adjusted for better sensitivity
const ONLINE_CONFIDENCE_THRESHOLD = 1; // Lowered - only need 1 positive to consider online (very sensitive)
const OFFLINE_CONFIDENCE_THRESHOLD = 3; // Increased - need more consecutive offline checks to consider offline

// Read configuration from environment
const ENABLE_NETWORK_SCAN = process.env.ENABLE_NETWORK_SCAN !== 'false';
const SCAN_SUBNET_RANGE = parseInt(process.env.SCAN_SUBNET_RANGE, 10) || 20;

/**
 * Check the device status and update session records with improved reliability
 */
async function checkAndUpdateDeviceStatus() {
    try {
        console.log('Checking device status...');
        const deviceName = process.env.TARGET_DEVICE_NAME;
        const macAddress = process.env.TARGET_MAC;

        const now = new Date();
        lastCheckTime = now;

        // Get the current device status using multiple methods in parallel for better reliability
        let isCurrentlyOnline = false;
        let detectionResults = [];

        // If we have network scanning enabled and haven't done a full subnet scan yet, do one now
        if (ENABLE_NETWORK_SCAN && !initialScanDone) {
            console.log('Performing initial full subnet scan to discover device...');
            await performFullNetworkScan();
            initialScanDone = true;
        }

        // If we have known IPs, try pinging them first as it's faster and more reliable than router checks
        if (knownDeviceIPs.size > 0) {
            console.log(`Checking ${knownDeviceIPs.size} known device IPs...`);

            // Try all known IPs in parallel
            const pingPromises = Array.from(knownDeviceIPs).map((ip) =>
                pingUtils.pingDevice(ip, 2).then((result) => {
                    if (result) console.log(`✅ Ping to ${ip} succeeded!`);
                    return { ip, result };
                }),
            );

            const pingResults = await Promise.all(pingPromises);

            // Check if any ping was successful
            for (const { ip, result } of pingResults) {
                detectionResults.push({ method: `ping-${ip}`, result });
                if (result) {
                    console.log(`✅ Ping to ${ip} succeeded! Device is online.`);
                    isCurrentlyOnline = true;
                    deviceIP = ip; // Update primary device IP to the one that responded
                    break;
                }
            }
        }

        // If ping didn't find the device, try router checks as fallback
        if (!isCurrentlyOnline && !ENABLE_NETWORK_SCAN) {
            try {
                const routerCheck = await routerUtils.checkDeviceStatus();
                detectionResults.push({ method: 'router', result: routerCheck });

                if (routerCheck === true) {
                    isCurrentlyOnline = true;
                    console.log('✅ Router check says device is online');
                }
            } catch (error) {
                console.error('❌ Router check failed completely:', error.message);
            }
        }

        // If we still didn't find the device and network scanning is enabled, do a focused scan
        if (!isCurrentlyOnline && ENABLE_NETWORK_SCAN) {
            console.log(`Device not found on known IPs, trying focused network scan...`);
            const foundIPs = await performFocusedNetworkScan();

            // If we found any responsive IPs, check if device is now considered online
            if (foundIPs.length > 0) {
                isCurrentlyOnline = true;
                console.log(`✅ Network scan found potential device IPs: ${foundIPs.join(', ')}`);

                // Update deviceIP to the first found IP if we don't have one
                if (!deviceIP && foundIPs.length > 0) {
                    deviceIP = foundIPs[0];
                }
            }
        }

        // Update status history
        statusHistory.push({ timestamp: now, isOnline: isCurrentlyOnline });
        if (statusHistory.length > MAX_HISTORY_SIZE) {
            statusHistory.shift(); // Remove oldest entry
        }

        // Use more sophisticated status determination based on history and current check
        const { shouldBeConsideredOnline, confidence } = determineStatus(isCurrentlyOnline);

        // Log device state analysis
        console.log(
            `Status determination: current=${isCurrentlyOnline}, final=${shouldBeConsideredOnline}, confidence=${confidence.toFixed(
                2,
            )}`,
        );

        // Track the last time we detected an online status
        if (isCurrentlyOnline) {
            lastFoundOnlineTime = now;
        }

        // Device just came online
        if (shouldBeConsideredOnline && !isDeviceOnline) {
            consecutiveFalsePositives++;

            if (consecutiveFalsePositives >= ONLINE_CONFIDENCE_THRESHOLD) {
                console.log(`${deviceName} came ONLINE at ${now.toLocaleString()} (confidence: ${confidence.toFixed(2)})`);

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
                consecutiveFalsePositives = 0;
                consecutiveFalseNegatives = 0;

                // Try to discover device IP for future ping checks if we don't have it
                if (!deviceIP) {
                    await discoverDeviceIP();
                }
            } else {
                console.log(
                    `Detected possible online status. Confirming on next check... (${consecutiveFalsePositives}/${ONLINE_CONFIDENCE_THRESHOLD})`,
                );
            }
        }
        // Device just went offline
        else if (!shouldBeConsideredOnline && isDeviceOnline) {
            consecutiveFalseNegatives++;

            if (consecutiveFalseNegatives >= OFFLINE_CONFIDENCE_THRESHOLD) {
                console.log(
                    `${deviceName} went OFFLINE at ${now.toLocaleString()} (confidence: ${(1 - confidence).toFixed(2)})`,
                );

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
                consecutiveFalseNegatives = 0;
                consecutiveFalsePositives = 0;

                // Don't clear all IPs, but mark primary device IP as null
                deviceIP = null;
            } else {
                console.log(
                    `Detected possible offline status. Confirming on next check... (${consecutiveFalseNegatives}/${OFFLINE_CONFIDENCE_THRESHOLD})`,
                );
            }
        } else {
            // Status is consistent with previous state
            consecutiveFalsePositives = 0;
            consecutiveFalseNegatives = 0;

            // If the device is online, periodically try to discover its IP to maintain our list
            if (shouldBeConsideredOnline && Math.random() < 0.2) {
                // 20% chance each time
                await discoverDeviceIP();
            }
        }

        console.log(`Current device status: ${isDeviceOnline ? 'ONLINE ✅' : 'OFFLINE ❌'}`);
        return isDeviceOnline;
    } catch (error) {
        console.error('Error updating device status:', error);
        return isDeviceOnline;
    }
}

/**
 * Determine the device's actual status based on current check and history
 * @param {boolean} currentCheck - Current status check result
 * @returns {Object} - { shouldBeConsideredOnline, confidence }
 */
function determineStatus(currentCheck) {
    // Simple case: initial status or current check is true - prioritize online detection
    if (statusHistory.length <= 1 || currentCheck === true) {
        return { shouldBeConsideredOnline: currentCheck, confidence: currentCheck ? 1.0 : 0.0 };
    }

    // Calculate how many of the recent checks show online status
    const recentChecks = statusHistory.slice(-3); // Last 3 checks including current
    const onlineCount = recentChecks.filter((check) => check.isOnline).length;
    const confidence = onlineCount / recentChecks.length;

    // More sensitive to online status (lower threshold) and less sensitive to offline status (higher threshold)
    // This addresses the false negative issue where device is shown offline when it's online
    const confidenceThreshold = isDeviceOnline ? 0.15 : 0.7; // Hysteresis to avoid oscillation

    return {
        shouldBeConsideredOnline: confidence > confidenceThreshold,
        confidence,
    };
}

/**
 * Perform a full network scan to find the device
 */
async function performFullNetworkScan() {
    try {
        // Get subnet from router IP
        const baseIP = process.env.ROUTER_IP.split('.');
        const subnet = baseIP.slice(0, 3).join('.');

        console.log(`Performing full network scan on subnet ${subnet}.1-254...`);

        // Do a broader scan in batches
        const batchRanges = [
            [1, 50], // Common for home devices
            [51, 100], // Common for DHCP range
            [101, 150], // Common for DHCP range
            [151, 200], // Less common
            [201, 254], // Less common
        ];

        for (const [start, end] of batchRanges) {
            console.log(`Scanning IP range ${subnet}.${start}-${end}...`);
            const foundIPs = await pingUtils.scanSubnet(subnet, start, end);

            if (foundIPs.length > 0) {
                console.log(`Found ${foundIPs.length} responsive IPs in range ${start}-${end}`);
                // Add all found IPs to our known list - one of them might be our device
                foundIPs.forEach((ip) => knownDeviceIPs.add(ip));
            }
        }

        console.log(`Completed full network scan. Found ${knownDeviceIPs.size} total responsive IPs.`);
    } catch (error) {
        console.error('Error during full network scan:', error);
    }
}

/**
 * Perform a focused network scan looking for the device near the router
 * and previously discovered IP addresses
 */
async function performFocusedNetworkScan() {
    try {
        // Get subnet from router IP
        const baseIP = process.env.ROUTER_IP.split('.');
        const routerLastOctet = parseInt(baseIP[3]);
        const subnet = baseIP.slice(0, 3).join('.');

        console.log(`Performing focused network scan around router (${process.env.ROUTER_IP})...`);

        // Range to scan on either side of the router IP
        const scanRange = SCAN_SUBNET_RANGE || 20;

        // Calculate start and end IPs, ensuring they stay within valid range (1-254)
        const start = Math.max(1, routerLastOctet - scanRange);
        const end = Math.min(254, routerLastOctet + scanRange);

        console.log(`Scanning focused IP range ${subnet}.${start}-${end}...`);
        const foundIPs = await pingUtils.scanSubnet(subnet, start, end);

        if (foundIPs.length > 0) {
            console.log(`Found ${foundIPs.length} responsive IPs in focused scan`);
            // Add all found IPs to our known list
            foundIPs.forEach((ip) => knownDeviceIPs.add(ip));
        }

        return foundIPs;
    } catch (error) {
        console.error('Error during focused network scan:', error);
        return [];
    }
}

/**
 * Try to discover the device IP address for ping checks with improved scanning
 */
async function discoverDeviceIP() {
    try {
        console.log('Trying to discover device IP address...');

        // Get subnet from router IP
        const baseIP = process.env.ROUTER_IP.split('.');
        const subnet = baseIP.slice(0, 3).join('.');

        // Dynamic and more comprehensive IP discovery
        // Start with common DHCP addresses + previously discovered IPs
        let ipsToCheck = [];

        // Add common DHCP-assigned ranges
        const commonLastOctets = [2, 3, 4, 5, 10, 11, 12, 20, 50, 51, 52, 100, 101, 102, 150, 151, 152, 200, 201, 202];
        for (const lastOctet of commonLastOctets) {
            ipsToCheck.push(`${subnet}.${lastOctet}`);
        }

        // If we previously found an IP, check nearby IPs with higher priority
        if (deviceIP) {
            const lastOctet = parseInt(deviceIP.split('.')[3]);
            // Check IPs close to the last known IP first
            for (let i = -3; i <= 3; i++) {
                if (i === 0) continue; // Skip the exact IP we already know
                const nearbyOctet = lastOctet + i;
                if (nearbyOctet > 0 && nearbyOctet < 255) {
                    ipsToCheck.unshift(`${subnet}.${nearbyOctet}`); // Add to beginning for priority
                }
            }
        }

        // Make sure the exact IP we already know is checked first
        if (deviceIP) {
            ipsToCheck.unshift(deviceIP);
        }

        // Deduplicate IPs to avoid redundant checks
        ipsToCheck = [...new Set(ipsToCheck)];

        // Check IPs in parallel batches to speed up discovery
        const BATCH_SIZE = 10; // Increased batch size for faster checking
        for (let i = 0; i < ipsToCheck.length; i += BATCH_SIZE) {
            const batch = ipsToCheck.slice(i, i + BATCH_SIZE);
            const promises = batch.map((ip) => pingUtils.pingDevice(ip, 1).then((result) => ({ ip, result })));

            const results = await Promise.all(promises);

            // Process results
            for (const { ip, result } of results) {
                if (result) {
                    console.log(`Found reachable IP: ${ip} - adding to known device IPs`);
                    // Store all discovered IPs
                    knownDeviceIPs.add(ip);
                    // Set as primary device IP if none exists
                    if (!deviceIP) {
                        deviceIP = ip;
                    }
                }
            }

            // If we found at least 3 reachable IPs, that's enough for now
            if (results.filter((r) => r.result).length >= 3) {
                break;
            }
        }

        if (knownDeviceIPs.size === 0) {
            console.log('Could not discover any device IP addresses');
        } else {
            console.log(`Known device IPs: ${Array.from(knownDeviceIPs).join(', ')}`);
        }
    } catch (error) {
        console.error('Error discovering device IP:', error);
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
 * Initialize the device tracker with improved reliability
 * - Sets up the initial device status
 * - Handles any active sessions from previous runs
 */
async function initialize() {
    try {
        console.log('-----------------------------------');
        console.log('Initializing device tracker...');
        console.log(`Target device: ${process.env.TARGET_DEVICE_NAME} (MAC: ${process.env.TARGET_MAC})`);
        console.log(`Router IP: ${process.env.ROUTER_IP}`);
        console.log(`Network scanning: ${ENABLE_NETWORK_SCAN ? 'ENABLED' : 'DISABLED'}`);
        console.log('-----------------------------------');

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

        // Initialize status history with offline state
        statusHistory = [];

        // If network scanning is enabled, start with that
        if (ENABLE_NETWORK_SCAN) {
            console.log('Starting with network scan to establish baseline...');
            await performFullNetworkScan();

            // If we found IPs, check if we can detect the device
            if (knownDeviceIPs.size > 0) {
                let deviceFound = false;

                // Try pinging each known IP
                for (const ip of knownDeviceIPs) {
                    const pingResult = await pingUtils.pingDevice(ip, 2);
                    if (pingResult) {
                        console.log(`Found responsive IP at ${ip} - assuming device is online`);
                        deviceIP = ip;
                        deviceFound = true;

                        // Add to status history that device is online
                        statusHistory.push({
                            timestamp: new Date(),
                            isOnline: true,
                        });

                        break;
                    }
                }

                // If device not found, assume offline
                if (!deviceFound) {
                    statusHistory.push({
                        timestamp: new Date(),
                        isOnline: false,
                    });
                }
            }
        }

        // If we don't have status history from network scan, fall back to router checks
        if (statusHistory.length === 0) {
            // Perform multiple status checks to establish a baseline
            console.log('Performing initial status checks to establish baseline...');

            // Do three quick checks to build initial history
            for (let i = 0; i < 3; i++) {
                try {
                    const isOnline = await routerUtils.checkDeviceStatus();
                    statusHistory.push({
                        timestamp: new Date(),
                        isOnline: isOnline,
                    });
                    console.log(`Initial check ${i + 1}/3: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);
                } catch (error) {
                    console.error(`Error in initial check ${i + 1}:`, error);
                    statusHistory.push({
                        timestamp: new Date(),
                        isOnline: false,
                    });
                }

                // Small delay between checks
                if (i < 2) await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        }

        // Determine initial state based on majority or most recent check
        if (statusHistory.length > 0) {
            // If any check is positive, consider device online (prioritize positive detection)
            const anyOnline = statusHistory.some((status) => status.isOnline);
            isDeviceOnline = anyOnline;
        } else {
            // Default to offline if we have no history
            isDeviceOnline = false;
        }

        console.log(`Determined initial device status: ${isDeviceOnline ? 'ONLINE ✅' : 'OFFLINE ❌'}`);

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

            // Try to discover device IP for future ping checks
            if (!deviceIP && !ENABLE_NETWORK_SCAN) {
                await discoverDeviceIP();
            }
        } else {
            // If initially offline, schedule a faster check to detect when device comes online
            console.log('Device initially offline - will check again soon');
        }

        console.log('Device tracker initialized successfully with improved reliability');
        console.log('-----------------------------------');
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
