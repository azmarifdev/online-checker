const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

// Configure router credentials
const routerIP = process.env.ROUTER_IP;
const username = process.env.ROUTER_USERNAME;
const password = process.env.ROUTER_PASSWORD;
const targetMAC = process.env.TARGET_MAC;
const targetDeviceName = process.env.TARGET_DEVICE_NAME;

/**
 * Check if the target device is connected to the router
 * This function uses web scraping to check the connected devices on TP-Link router
 */
async function checkDeviceStatus() {
    try {
        console.log('Checking device status using web scraping approach...');

        // Basic auth for router login
        const authString = Buffer.from(`${username}:${password}`).toString('base64');

        // First, try to access the network map page directly
        const response = await axios.get(`http://${routerIP}/networkMap`, {
            headers: {
                Authorization: `Basic ${authString}`,
                'Content-Type': 'text/html',
                Accept: 'text/html',
            },
            timeout: 5000,
        });

        // Get the HTML content
        const html = response.data;

        // Use cheerio to parse the HTML
        const $ = cheerio.load(html);

        // The device status may be in different places depending on the router model
        // Let's try multiple approaches to find connected devices

        // Method 1: Looking for client list or connected clients section
        let isDeviceConnected = false;

        // Look for MAC address in the page
        const pageContent = html.toString();

        // Convert the target MAC address format for different possible formats
        const macFormats = generateMACFormats(targetMAC);

        console.log(`Looking for MAC address in formats:`, macFormats);

        // Check if any of the MAC formats are found in the page
        for (const macFormat of macFormats) {
            if (pageContent.includes(macFormat)) {
                console.log(`Found device MAC: ${macFormat} in router page`);
                isDeviceConnected = true;
                break;
            }
        }

        // Method 2: Check if the device name exists in the page
        if (!isDeviceConnected && targetDeviceName) {
            if (pageContent.includes(targetDeviceName)) {
                console.log(`Found device name: ${targetDeviceName} in router page`);
                isDeviceConnected = true;
            }
        }

        // If above methods fail, try to fetch the client list page
        if (!isDeviceConnected) {
            console.log('Trying alternative approach to check connected devices...');

            try {
                // Try accessing the client list or connected devices page
                const clientsResponse = await axios.get(`http://${routerIP}/cgi-bin/luci/admin/status/overview`, {
                    headers: {
                        Authorization: `Basic ${authString}`,
                        'Content-Type': 'text/html',
                        Accept: 'text/html',
                    },
                    timeout: 5000,
                });

                const clientsHtml = clientsResponse.data;

                // Check for MAC address in this page
                for (const macFormat of macFormats) {
                    if (clientsHtml.includes(macFormat)) {
                        console.log(`Found device MAC: ${macFormat} in clients page`);
                        isDeviceConnected = true;
                        break;
                    }
                }

                // Also check for device name
                if (!isDeviceConnected && targetDeviceName) {
                    if (clientsHtml.includes(targetDeviceName)) {
                        console.log(`Found device name: ${targetDeviceName} in clients page`);
                        isDeviceConnected = true;
                    }
                }
            } catch (error) {
                console.log('Failed to access clients page:', error.message);
            }
        }

        // Try one more approach if needed - accessing the JSON API if available
        if (!isDeviceConnected) {
            console.log('Trying JSON API approach...');

            try {
                // Some TP-Link routers have a JSON endpoint for clients
                const jsonResponse = await axios.get(`http://${routerIP}/cgi-bin/luci/admin/network/clients`, {
                    headers: {
                        Authorization: `Basic ${authString}`,
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
                    },
                    timeout: 5000,
                });

                // If response is JSON, parse it
                if (typeof jsonResponse.data === 'object') {
                    const devices = jsonResponse.data.clients || jsonResponse.data.devices || [];
                    isDeviceConnected = devices.some((device) => {
                        // Check various MAC address formats
                        const deviceMAC = device.mac || device.macaddr || device.hwaddr || '';
                        return macFormats.some((format) => deviceMAC.toLowerCase() === format.toLowerCase());
                    });

                    if (isDeviceConnected) {
                        console.log('Found device in JSON client list');
                    }
                }
            } catch (error) {
                console.log('Failed to access JSON API:', error.message);
            }
        }

        console.log(`Final device connection status: ${isDeviceConnected ? 'ONLINE' : 'OFFLINE'}`);
        return isDeviceConnected;
    } catch (error) {
        console.error('Error checking device status:', error.message);
        // If there's an error, we'll assume the device status hasn't changed
        return false;
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
