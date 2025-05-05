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

/**
 * Check if the target device is connected to the router
 * This function tries multiple methods to detect device status
 */
async function checkDeviceStatus() {
    try {
        console.log('Checking device status...');

        // Try each method in order until one succeeds
        const methods = [
            tryArcherC64DirectAccess, // Added specialized method for Archer C64
            tryNetworkMapAccess,
            tryTPLinkAPI,
            tryRouterLogin,
            tryDirectScraping,
        ];

        for (const method of methods) {
            try {
                console.log(`Trying method: ${method.name}`);
                const result = await method();
                if (result !== null) {
                    console.log(`Method ${method.name} returned: ${result ? 'ONLINE' : 'OFFLINE'}`);
                    return result;
                }
            } catch (error) {
                console.log(`Method ${method.name} failed: ${error.message}`);
            }
        }

        // If all methods fail, return false (offline)
        console.log('All methods failed, assuming device is offline');
        return false;
    } catch (error) {
        console.error('Error checking device status:', error.message);
        return false;
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
 * Try to login to router and check connected devices
 */
async function tryRouterLogin() {
    try {
        // Basic auth for router login
        const authString = Buffer.from(`${username}:${password}`).toString('base64');

        // Try a different endpoint - some routers use this path
        const response = await axios.get(`http://${routerIP}/admin/status?form=all`, {
            headers: {
                Authorization: `Basic ${authString}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            },
            timeout: 5000,
        });

        if (response.data) {
            const data = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
            const macFormats = generateMACFormats(targetMAC);

            // Check if any MAC format is in the response
            for (const macFormat of macFormats) {
                if (data.includes(macFormat)) {
                    console.log(`Found device MAC: ${macFormat} in router status`);
                    return true;
                }
            }

            // Also check device name
            if (data.includes(targetDeviceName)) {
                console.log(`Found device name: ${targetDeviceName} in router status`);
                return true;
            }
        }

        return false;
    } catch (error) {
        console.log('Router login attempt failed:', error.message);
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
