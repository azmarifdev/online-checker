const axios = require('axios');
const cheerio = require('cheerio');
const { Client } = require('tplink-smarthome-api');
require('dotenv').config();

// Configure router credentials
const routerIP = process.env.ROUTER_IP;
const username = process.env.ROUTER_USERNAME;
const password = process.env.ROUTER_PASSWORD;
const targetMAC = process.env.TARGET_MAC;
const targetDeviceName = process.env.TARGET_DEVICE_NAME;

// Initialize TP-Link client
const client = new Client();

// Session management
let routerAuthToken = null;
let tokenExpiry = null;
let lastAuthAttempt = null;
const AUTH_COOLDOWN = 30000; // 30 seconds between auth attempts
const SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

/**
 * Check if the target device is connected to the router
 * This function tries multiple methods in parallel for better reliability
 */
async function checkDeviceStatus() {
    try {
        console.log('Checking device status...');

        // Run multiple methods in parallel for faster and more reliable detection
        const methodResults = await Promise.allSettled([
            // Primary methods first - these directly check router status
            runWithTimeout(tryArcherC64DirectAccess(), 5000, 'Archer C64 direct access'),
            runWithTimeout(
                tryGetAuthToken().then(() => tryWithAuth()),
                7000,
                'Authenticated router check',
            ),
            runWithTimeout(tryNetworkMapAccess(), 5000, 'Network Map access'),
        ]);

        // Process results in priority order
        for (const result of methodResults) {
            if (result.status === 'fulfilled' && result.value === true) {
                console.log('Device found online by primary method');
                return true;
            }
        }

        // If primary methods didn't find the device, try fallback methods
        const fallbackResults = await Promise.allSettled([
            runWithTimeout(tryTPLinkAPI(), 8000, 'TP-Link API'),
            runWithTimeout(tryDirectScraping(), 5000, 'Direct scraping'),
        ]);

        for (const result of fallbackResults) {
            if (result.status === 'fulfilled' && result.value === true) {
                console.log('Device found online by fallback method');
                return true;
            }
        }

        // If we got here, all methods either failed or returned false
        return false;
    } catch (error) {
        console.error('Error in device status check:', error.message);
        return false;
    }
}

/**
 * Run a promise with a timeout
 * @param {Promise} promise - The promise to run
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} operationName - Name of the operation for logging
 * @returns {Promise} - The result of the original promise or null if it times out
 */
async function runWithTimeout(promise, timeoutMs, operationName) {
    try {
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs);
        });

        return await Promise.race([promise, timeoutPromise]);
    } catch (error) {
        console.log(`${operationName} failed or timed out: ${error.message}`);
        return null;
    }
}

/**
 * Get auth token for router access
 */
async function tryGetAuthToken() {
    // Skip if we already have a valid token
    const now = Date.now();
    if (routerAuthToken && tokenExpiry && tokenExpiry > now) {
        return routerAuthToken;
    }

    // Avoid hammering the router with auth requests
    if (lastAuthAttempt && now - lastAuthAttempt < AUTH_COOLDOWN) {
        throw new Error('Auth attempt too recent, cooling down');
    }

    lastAuthAttempt = now;

    try {
        // Try common auth endpoints
        const authEndpoints = [`/cgi-bin/luci/login`, `/cgi-bin/luci/api/auth`, `/login`, `/api/auth`];

        for (const endpoint of authEndpoints) {
            try {
                console.log(`Attempting authentication at ${endpoint}...`);
                const response = await axios.post(
                    `http://${routerIP}${endpoint}`,
                    `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
                    {
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'User-Agent':
                                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        },
                        timeout: 5000,
                    },
                );

                // Look for auth token in response
                let token = null;

                // Check response data for token
                if (response.data) {
                    if (typeof response.data === 'string' && response.data.includes('stok')) {
                        const match = response.data.match(/stok=([^"&]+)/);
                        if (match) token = match[1];
                    } else if (response.data.token || response.data.stok) {
                        token = response.data.token || response.data.stok;
                    }
                }

                // Check cookies for token
                if (!token && response.headers['set-cookie']) {
                    const cookies = response.headers['set-cookie'].join(';');
                    if (cookies.includes('sysauth=')) {
                        const match = cookies.match(/sysauth=([^;]+)/);
                        if (match) token = match[1];
                    }
                }

                if (token) {
                    console.log('Authentication successful');
                    routerAuthToken = token;
                    tokenExpiry = now + SESSION_TIMEOUT;
                    return token;
                }
            } catch (err) {
                console.log(`Auth attempt at ${endpoint} failed: ${err.message}`);
            }
        }

        throw new Error('Failed to authenticate with router');
    } catch (error) {
        console.error('Router authentication error:', error.message);
        routerAuthToken = null;
        tokenExpiry = null;
        throw error;
    }
}

/**
 * Try authenticated router access methods
 */
async function tryWithAuth() {
    try {
        if (!routerAuthToken) return null;

        console.log('Trying authenticated device list access...');

        // URLs to try with authentication
        const urlsToTry = [
            `/cgi-bin/luci/;stok=${routerAuthToken}/admin/status/online_clients`,
            `/cgi-bin/luci/;stok=${routerAuthToken}/admin/status/online_clients/list`,
            `/cgi-bin/luci/;stok=${routerAuthToken}/admin/status/client_list`,
            `/data/status/device_list.json?token=${routerAuthToken}`,
        ];

        for (const url of urlsToTry) {
            try {
                const response = await axios.get(`http://${routerIP}${url}`, {
                    headers: {
                        'User-Agent':
                            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        Cookie: `sysauth=${routerAuthToken}`,
                    },
                    timeout: 4000,
                });

                if (response.data) {
                    const data = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
                    const macFormats = generateMACFormats(targetMAC);

                    // Check for MAC address
                    for (const macFormat of macFormats) {
                        if (data.includes(macFormat)) {
                            console.log(`Found device MAC: ${macFormat} in authenticated access`);
                            return true;
                        }
                    }

                    // Check for device name
                    if (data.includes(targetDeviceName)) {
                        console.log(`Found device name: ${targetDeviceName} in authenticated access`);
                        return true;
                    }

                    // If we get a response with client data but our device isn't in it
                    if (data.includes('clients') || data.includes('online_clients') || data.includes('deviceList')) {
                        console.log('Got device list but target device not found');
                        return false;
                    }
                }
            } catch (e) {
                console.log(`Auth access failed for ${url}: ${e.message}`);
            }
        }

        return null; // Signal to try next method
    } catch (error) {
        console.log('Authenticated access failed:', error.message);
        return null;
    }
}

/**
 * Specialized method for Archer C64 router based on the screenshot
 */
async function tryArcherC64DirectAccess() {
    try {
        console.log('Trying specialized Archer C64 direct access method...');

        // Make a direct GET request to the network map page
        const response = await axios.get(`http://${routerIP}/cgi-bin/luci/;stok=/admin/status/online_clients`, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                Accept: 'text/html,application/xhtml+xml,application/xml',
                Cookie: 'sysauth=anyvalue', // Some routers need a cookie even if invalid
            },
            timeout: 5000,
        });

        if (response.data) {
            const data = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

            // Check for the MAC address in the response
            const cleanTargetMAC = targetMAC.replace(/[:-]/g, '').toLowerCase();
            const macFormats = generateMACFormats(targetMAC);

            for (const macFormat of macFormats) {
                if (data.includes(macFormat)) {
                    console.log(`Found device MAC: ${macFormat} in Archer C64 network map!`);
                    return true;
                }
            }

            // Also check for device name
            if (data.includes(targetDeviceName)) {
                console.log(`Found device name: ${targetDeviceName} in Archer C64 network map!`);
                return true;
            }
        }

        return false;
    } catch (error) {
        console.log('Archer C64 direct access failed:', error.message);
        return null; // Signal to try next method
    }
}

/**
 * Try accessing the NetworkMap page directly as shown in the screenshot
 */
async function tryNetworkMapAccess() {
    try {
        console.log('Trying Network Map access as shown in screenshot...');

        // URLs to try based on your screenshot and common TP-Link paths
        const urlsToTry = [
            `http://${routerIP}/#networkMap`,
            `http://${routerIP}/networkMap`,
            `http://${routerIP}/webpages/index.html#networkMap`,
            `http://${routerIP}/cgi-bin/luci/admin/clients`,
        ];

        for (const url of urlsToTry) {
            try {
                console.log(`Trying URL: ${url}`);
                const response = await axios.get(url, {
                    headers: {
                        'User-Agent':
                            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    },
                    timeout: 5000,
                });

                if (response.data) {
                    const data = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

                    // Check for MAC address
                    const macFormats = generateMACFormats(targetMAC);
                    for (const macFormat of macFormats) {
                        if (data.includes(macFormat)) {
                            console.log(`Found device MAC: ${macFormat} in Network Map!`);
                            return true;
                        }
                    }

                    // Also check device name
                    if (data.includes(targetDeviceName)) {
                        console.log(`Found device name: ${targetDeviceName} in Network Map!`);
                        return true;
                    }
                }
            } catch (e) {
                console.log(`Failed to access ${url}: ${e.message}`);
            }
        }

        // Try AJAX endpoint for client list specifically for Archer routers
        try {
            const clientListUrl = `http://${routerIP}/cgi-bin/luci/admin/status/online_clients/list`;
            console.log(`Trying AJAX client list URL: ${clientListUrl}`);

            const response = await axios.get(clientListUrl, {
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'X-Requested-With': 'XMLHttpRequest',
                    Accept: 'application/json',
                },
                timeout: 5000,
            });

            if (response.data && typeof response.data === 'object') {
                const clients = response.data.clients || response.data.devices || [];
                const macFormats = generateMACFormats(targetMAC);
                const cleanTargetMAC = targetMAC.replace(/[:-]/g, '').toLowerCase();

                for (const client of clients) {
                    const clientMac = client.mac || client.macaddr || client.hwaddr || '';
                    const clientName = client.hostname || client.name || '';

                    if (macFormats.some((format) => clientMac.toLowerCase().includes(cleanTargetMAC))) {
                        console.log(`Found device in client list with MAC: ${clientMac}`);
                        return true;
                    }

                    if (clientName.includes(targetDeviceName)) {
                        console.log(`Found device in client list with name: ${clientName}`);
                        return true;
                    }
                }
            }
        } catch (e) {
            console.log(`Failed to access AJAX client list: ${e.message}`);
        }

        return null; // Signal to try next method
    } catch (error) {
        console.log('Network Map access failed:', error.message);
        return null; // Signal to try next method
    }
}

/**
 * Try to use the TP-Link API to check device status
 */
async function tryTPLinkAPI() {
    try {
        // Try to discover devices on the network
        const macFormats = generateMACFormats(targetMAC);
        const cleanTargetMAC = targetMAC.replace(/[:-]/g, '').toLowerCase();

        // Start discovery process
        console.log('Starting TP-Link device discovery...');

        // Return a promise that resolves when device is found or times out
        return new Promise((resolve, reject) => {
            let found = false;
            let timeout = setTimeout(() => {
                client.stopDiscovery();
                if (!found) {
                    console.log('TP-Link discovery timeout - no matching device found');
                    resolve(false);
                }
            }, 10000); // 10 second timeout

            // Set up discovery
            client
                .startDiscovery()
                .on('device-new', (device) => {
                    console.log(`Found device: ${device.host} (${device.deviceType})`);
                    // Try to get more info about the device
                    device
                        .getSysInfo()
                        .then((info) => {
                            console.log(`Device info for ${device.host}:`, JSON.stringify(info).substring(0, 100) + '...');
                            if (info.mac && macFormats.some((format) => info.mac.toLowerCase().includes(cleanTargetMAC))) {
                                console.log(`Found matching device via TP-Link API: ${device.host}`);
                                clearTimeout(timeout);
                                found = true;
                                client.stopDiscovery();
                                resolve(true);
                            }
                        })
                        .catch((err) => console.log(`Error getting device info for ${device.host}: ${err.message}`));
                })
                .on('error', (err) => {
                    console.error('TP-Link discovery error:', err);
                    if (!found) {
                        clearTimeout(timeout);
                        client.stopDiscovery();
                        resolve(null); // Signal to try next method
                    }
                });
        });
    } catch (error) {
        console.log('TP-Link API method failed:', error.message);
        return null; // Signal to try next method
    }
}

/**
 * Try direct HTML scraping for connected clients
 */
async function tryDirectScraping() {
    try {
        // No authentication - some routers don't require it for certain info
        const directApproaches = [
            // Different possible endpoints that might work
            `http://${routerIP}/data/getDeviceList.json`,
            `http://${routerIP}/ajax/clients.asp`,
            `http://${routerIP}/cgi-bin/luci/admin/status/overview`,
            `http://${routerIP}/cgi-bin/home.asp`,
            // Additional endpoints for Archer C64
            `http://${routerIP}/cgi-bin/luci/admin/status/online_clients`,
            `http://${routerIP}/cgi-bin/luci/;stok=/admin/status/online_clients`,
            `http://${routerIP}/webpages/index.html#wireless_client`,
        ];

        for (const url of directApproaches) {
            try {
                console.log(`Trying direct access: ${url}`);
                const response = await axios.get(url, {
                    timeout: 3000,
                    headers: {
                        'User-Agent':
                            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    },
                });

                if (response.data) {
                    const data = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
                    const macFormats = generateMACFormats(targetMAC);

                    // Check if any MAC format is in the response
                    for (const macFormat of macFormats) {
                        if (data.includes(macFormat)) {
                            console.log(`Found device MAC: ${macFormat} in direct scraping`);
                            return true;
                        }
                    }

                    // Also check device name
                    if (targetDeviceName && data.includes(targetDeviceName)) {
                        console.log(`Found device name: ${targetDeviceName} in direct scraping`);
                        return true;
                    }
                }
            } catch (e) {
                console.log(`Direct access failed for ${url}: ${e.message}`);
                // Continue to next URL
            }
        }

        return false;
    } catch (error) {
        console.log('Direct scraping method failed:', error.message);
        return false; // Last method, so return a definite result
    }
}

/**
 * Generate different formats of MAC address that might appear in router HTML
 * @param {string} mac - The original MAC address
 * @returns {string[]} - Array of possible MAC address formats
 */
function generateMACFormats(mac) {
    // Remove any existing separators and convert to lowercase
    const cleanMAC = mac.replace(/[:-]/g, '').toLowerCase();

    if (cleanMAC.length !== 12) {
        console.warn('Invalid MAC address format');
        return [mac];
    }

    // Generate different formats
    const formats = [
        // Original format (as provided in env)
        mac,
        // Lowercase with colons
        cleanMAC.match(/.{1,2}/g).join(':'),
        // Uppercase with colons
        cleanMAC
            .match(/.{1,2}/g)
            .join(':')
            .toUpperCase(),
        // Lowercase with hyphens
        cleanMAC.match(/.{1,2}/g).join('-'),
        // Uppercase with hyphens
        cleanMAC
            .match(/.{1,2}/g)
            .join('-')
            .toUpperCase(),
        // No separators lowercase
        cleanMAC,
        // No separators uppercase
        cleanMAC.toUpperCase(),
    ];

    return formats;
}

module.exports = {
    checkDeviceStatus,
};
