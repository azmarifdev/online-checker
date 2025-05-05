const nodemailer = require('nodemailer');
require('dotenv').config();

// Create a transporter object using SMTP transport
const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

/**
 * Send an email notification
 * @param {string} subject - Email subject
 * @param {string} html - Email body in HTML format
 */
async function sendEmail(subject, html) {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: process.env.EMAIL_RECIPIENT,
        subject: subject,
        html: html,
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent: ', info.messageId);
        return true;
    } catch (error) {
        console.error('Error sending email: ', error);
        return false;
    }
}

/**
 * Send a device online notification
 * @param {string} deviceName - Name of the device
 */
async function sendOnlineNotification(deviceName) {
    const subject = `✅ ${deviceName} is now ONLINE`;
    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
      <h2 style="color: #4CAF50; text-align: center;">Device Online Notification</h2>
      <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin-top: 20px;">
        <p style="font-size: 16px;"><strong>${deviceName}</strong> is now <span style="color: #4CAF50; font-weight: bold;">ONLINE</span></p>
        <p style="font-size: 14px; color: #666;">Connection time: ${new Date().toLocaleString()}</p>
      </div>
      <p style="margin-top: 20px; font-size: 14px; color: #888; text-align: center;">
        This is an automated notification from your Device Tracker.
      </p>
    </div>
  `;
    return await sendEmail(subject, html);
}

/**
 * Send a device offline notification
 * @param {string} deviceName - Name of the device
 * @param {Date} onlineTime - When the device came online
 * @param {number} durationMinutes - Session duration in minutes
 */
async function sendOfflineNotification(deviceName, onlineTime, durationMinutes) {
    const subject = `❌ ${deviceName} is now OFFLINE`;
    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
      <h2 style="color: #F44336; text-align: center;">Device Offline Notification</h2>
      <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin-top: 20px;">
        <p style="font-size: 16px;"><strong>${deviceName}</strong> is now <span style="color: #F44336; font-weight: bold;">OFFLINE</span></p>
        <p style="font-size: 14px; color: #666;">Disconnection time: ${new Date().toLocaleString()}</p>
        <p style="font-size: 14px; color: #666;">Online since: ${onlineTime.toLocaleString()}</p>
        <p style="font-size: 14px; color: #666;">Session duration: ${formatDuration(durationMinutes)}</p>
      </div>
      <p style="margin-top: 20px; font-size: 14px; color: #888; text-align: center;">
        This is an automated notification from your Device Tracker.
      </p>
    </div>
  `;
    return await sendEmail(subject, html);
}

/**
 * Send a daily summary email
 * @param {Array} sessions - Array of session objects for the day
 * @param {number} totalMinutes - Total online time in minutes
 */
async function sendDailySummaryEmail(sessions, totalMinutes) {
    const date = new Date().toLocaleDateString();
    const subject = `📊 Device Tracker - Daily Summary (${date})`;

    // Generate HTML for sessions table
    let sessionsHtml = '';
    sessions.forEach((session) => {
        sessionsHtml += `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${session.onlineTime.toLocaleString()}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${
            session.offlineTime ? session.offlineTime.toLocaleString() : 'Still Online'
        }</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${
            session.duration ? formatDuration(session.duration) : 'N/A'
        }</td>
      </tr>
    `;
    });

    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
      <h2 style="color: #2196F3; text-align: center;">Daily Activity Summary</h2>
      <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin-top: 20px;">
        <p style="font-size: 16px;"><strong>Date:</strong> ${date}</p>
        <p style="font-size: 16px;"><strong>Device:</strong> ${process.env.TARGET_DEVICE_NAME}</p>
        <p style="font-size: 16px;"><strong>Total Online Time:</strong> ${formatDuration(totalMinutes)}</p>
        <p style="font-size: 16px;"><strong>Total Sessions:</strong> ${sessions.length}</p>
      </div>
      
      <h3 style="margin-top: 30px;">Session Details</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background-color: #f2f2f2;">
            <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Online Time</th>
            <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Offline Time</th>
            <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Duration</th>
          </tr>
        </thead>
        <tbody>
          ${sessionsHtml}
        </tbody>
      </table>
      
      <p style="margin-top: 20px; font-size: 14px; color: #888; text-align: center;">
        This is an automated summary from your Device Tracker.
      </p>
    </div>
  `;
    return await sendEmail(subject, html);
}

/**
 * Format minutes into hours and minutes string
 * @param {number} minutes - Duration in minutes
 * @returns {string} Formatted duration string
 */
function formatDuration(minutes) {
    if (minutes < 1) {
        return 'Less than a minute';
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    let result = '';
    if (hours > 0) {
        result += `${hours} hour${hours > 1 ? 's' : ''}`;
    }
    if (remainingMinutes > 0) {
        result += `${hours > 0 ? ' ' : ''}${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}`;
    }

    return result;
}

module.exports = {
    sendOnlineNotification,
    sendOfflineNotification,
    sendDailySummaryEmail,
};
