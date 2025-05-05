const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Try to ping a device by IP address
 * @param {string} ipAddress - The IP address to ping
 * @returns {Promise<boolean>} - True if device is reachable, false otherwise
 */
async function pingDevice(ipAddress) {
    try {
        // Use different commands based on OS
        const command = process.platform === 'win32' ? `ping -n 2 -w 1000 ${ipAddress}` : `ping -c 2 -W 1 ${ipAddress}`;

        console.log(`Attempting to ping ${ipAddress}...`);
        const { stdout } = await execPromise(command);

        // Check if we got a reply
        const isReachable =
            process.platform === 'win32' ? !stdout.includes('Request timed out') : !stdout.includes('0 received');

        console.log(`Ping result for ${ipAddress}: ${isReachable ? 'REACHABLE' : 'UNREACHABLE'}`);
        return isReachable;
    } catch (error) {
        console.error(`Error pinging ${ipAddress}:`, error.message);
        return false;
    }
}

module.exports = {
    pingDevice,
};
