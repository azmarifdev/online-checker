const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Try to ping a device by IP address with improved reliability
 * @param {string} ipAddress - The IP address to ping
 * @param {number} [retries=2] - Number of retry attempts if first ping fails
 * @returns {Promise<boolean>} - True if device is reachable, false otherwise
 */
async function pingDevice(ipAddress, retries = 2) {
    // Validate IP address format
    if (!isValidIpAddress(ipAddress)) {
        console.error(`Invalid IP address format: ${ipAddress}`);
        return false;
    }

    try {
        console.log(`Attempting to ping ${ipAddress}...`);

        // For better reliability, we'll make multiple attempts with different parameters
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                // Use different commands based on OS and attempt number
                let command;
                if (process.platform === 'win32') {
                    // Windows ping commands with different parameters per attempt
                    if (attempt === 0) {
                        command = `ping -n 1 -w 500 ${ipAddress}`; // Fast single ping with shorter timeout
                    } else if (attempt === 1) {
                        command = `ping -n 2 -w 1000 ${ipAddress}`; // Two pings with medium timeout
                    } else {
                        command = `ping -n 3 -w 2000 ${ipAddress}`; // Three pings with longer timeout
                    }
                } else {
                    // Linux/Mac ping commands with different parameters per attempt
                    if (attempt === 0) {
                        command = `ping -c 1 -W 1 -t 1 ${ipAddress}`; // Fast single ping with TTL=1
                    } else if (attempt === 1) {
                        command = `ping -c 2 -W 1 ${ipAddress}`; // Two pings with standard timeout
                    } else {
                        command = `ping -c 3 -W 2 ${ipAddress}`; // Three pings with longer timeout
                    }
                }

                console.log(`Ping attempt ${attempt + 1}/${retries + 1} for ${ipAddress}: ${command}`);
                const { stdout, stderr } = await execPromise(command);

                // Check if we got a reply
                const isReachable =
                    process.platform === 'win32'
                        ? !stdout.includes('Request timed out') && !stdout.includes('Destination host unreachable')
                        : !stdout.includes('0 received') && !stdout.includes('100% packet loss');

                if (isReachable) {
                    console.log(`✅ Ping successful for ${ipAddress} (attempt ${attempt + 1}/${retries + 1})`);
                    return true;
                }

                console.log(`❌ Ping failed for ${ipAddress} (attempt ${attempt + 1}/${retries + 1})`);

                // Add a small delay between attempts
                if (attempt < retries) {
                    await new Promise((resolve) => setTimeout(resolve, 300)); // Reduced delay
                }
            } catch (attemptError) {
                console.log(`Ping attempt ${attempt + 1} error: ${attemptError.message}`);
                // Continue to next attempt
            }
        }

        // If we get here, all attempts failed
        console.log(`All ping attempts failed for ${ipAddress}`);
        return false;
    } catch (error) {
        console.error(`Error pinging ${ipAddress}:`, error.message);
        return false;
    }
}

/**
 * Validate IP address format
 * @param {string} ip - IP address to validate
 * @returns {boolean} - True if valid IPv4 address
 */
function isValidIpAddress(ip) {
    if (!ip) return false;

    // Check if string matches IPv4 pattern
    const pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    if (!pattern.test(ip)) return false;

    // Check if each part is between 0-255
    const parts = ip.split('.');
    for (const part of parts) {
        const num = parseInt(part);
        if (isNaN(num) || num < 0 || num > 255) return false;
    }

    return true;
}

/**
 * Scan a subnet for responsive IPs
 * @param {string} subnetBase - Base of subnet (e.g., "192.168.1")
 * @param {number} [start=1] - Start of IP range
 * @param {number} [end=10] - End of IP range
 * @returns {Promise<string[]>} - Array of responsive IPs
 */
async function scanSubnet(subnetBase, start = 1, end = 10) {
    if (end > 255) end = 255;
    if (start < 1) start = 1;
    if (start > end) [start, end] = [end, start];

    const results = [];

    // Limit concurrent pings to avoid overloading the network
    const BATCH_SIZE = 10; // Increased batch size for faster scanning

    console.log(`Scanning subnet ${subnetBase}.${start}-${end}...`);

    for (let i = start; i <= end; i += BATCH_SIZE) {
        const batch = [];

        // Create batch of ping promises
        for (let j = i; j < i + BATCH_SIZE && j <= end; j++) {
            const ip = `${subnetBase}.${j}`;
            // Use quick ping with no retries for scanning to speed it up
            batch.push(pingDevice(ip, 0).then((isReachable) => ({ ip, isReachable })));
        }

        // Execute batch in parallel
        const batchResults = await Promise.all(batch);

        // Add responsive IPs to results
        for (const result of batchResults) {
            if (result.isReachable) {
                console.log(`Found responsive IP: ${result.ip}`);
                results.push(result.ip);
            }
        }
    }

    return results;
}

/**
 * Find the possible IP of a device using aggressive scanning
 * @param {string} subnet - Subnet base (e.g., "192.168.1")
 * @returns {Promise<string[]>} - Array of all responsive IPs that might be our device
 */
async function findDeviceIP(subnet) {
    // Strategy: Check these ranges first as they're most common for DHCP assignment
    const priorityRanges = [
        [2, 20], // Common for routers, switches and first DHCP assignments
        [100, 120], // Common DHCP range
        [50, 70], // Another common DHCP range
        [200, 220], // Higher DHCP range
    ];

    const results = [];

    // First check priority ranges
    for (const [start, end] of priorityRanges) {
        console.log(`Scanning priority IP range ${subnet}.${start}-${end}...`);
        const foundIPs = await scanSubnet(subnet, start, end);
        results.push(...foundIPs);

        // If we found some IPs, we can stop scanning to save time
        if (foundIPs.length > 0) {
            console.log(`Found ${foundIPs.length} responsive IPs in priority range, stopping scan...`);
            break;
        }
    }

    return results;
}

module.exports = {
    pingDevice,
    scanSubnet,
    isValidIpAddress,
    findDeviceIP,
};
