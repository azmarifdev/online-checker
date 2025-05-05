# TP-Link Device Activity Tracker

A real-time automation system that continuously tracks the online/offline activity of a specific device connected to your TP-Link router's network via MAC address monitoring.

## Features

-   🔍 **Real-Time Device Monitoring**

    -   Detects when a specific device connects or disconnects from the network
    -   Monitors through TP-Link router's API or internal status page
    -   Supports periodic polling (configurable intervals)

-   🕒 **Timestamped Logging**

    -   Records online timestamp, offline timestamp, and session duration
    -   Calculates total online time per day
    -   Stores data in MongoDB Atlas

-   📈 **Web-Based Dashboard**

    -   Modern, clean UI built with Tailwind CSS
    -   Live status indicator
    -   Daily summary with total online time
    -   Chronological log records
    -   Historical logs with date filtering

-   📨 **Email Notifications**
    -   Real-time alerts when device connects/disconnects
    -   Daily summary emails (optional)

## System Requirements

-   Node.js 14.x or higher
-   MongoDB (Atlas or self-hosted)
-   TP-Link router with web interface access
-   cPanel hosting with Node.js support for deployment

## Installation

### Local Development Setup

1. **Clone the repository**

```bash
git clone https://github.com/yourusername/tplink-device-tracker.git
cd tplink-device-tracker
```

2. **Install dependencies**

```bash
npm install
```

3. **Set up environment variables**

Create a `.env` file in the project root with the following content:

```
# MongoDB settings
MONGODB_URI=your_mongodb_connection_string

# Router settings
ROUTER_IP=192.168.0.1
ROUTER_USERNAME=your_router_username
ROUTER_PASSWORD=your_router_password
TARGET_MAC=XX-XX-XX-XX-XX-XX
TARGET_DEVICE_NAME=DeviceName

# Server settings
PORT=3000

# Email settings
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
EMAIL_RECIPIENT=recipient-email@example.com

# Polling interval in milliseconds (30 seconds = 30000ms)
POLLING_INTERVAL=30000
```

4. **Start the application in development mode**

```bash
npm run dev
```

The application will be available at `http://localhost:3000`

### Production Deployment on cPanel

1. **Upload the project files to your cPanel**

    - Log in to your cPanel account
    - Navigate to File Manager
    - Create a folder (e.g., `device-tracker`)
    - Upload all project files to this folder

2. **Install dependencies on the server**

```bash
cd device-tracker
npm install --production
```

3. **Set up the environment variables**

Create a `.env` file with your production settings.

4. **Install PM2 globally**

```bash
npm install pm2 -g
```

5. **Start the application with PM2**

```bash
pm2 start ecosystem.config.js
```

6. **Set up PM2 to start on server reboot**

```bash
pm2 startup
pm2 save
```

## Router Configuration

The application is designed to work with TP-Link routers. Depending on your specific router model, you may need to adjust the router communication code in `utils/routerUtils.js`.

### Common Router Endpoints

-   TP-Link Archer series: `http://{ROUTER_IP}/cgi-bin/luci/admin/status/overview`
-   TP-Link TL-WR series: `http://{ROUTER_IP}/userRpm/StatusRpm.htm`

## Customizing the Application

### Modifying the Router API Integration

If your router model returns a different response format, you'll need to modify the `parseConnectedDevices` function in `utils/routerUtils.js` to properly extract device information.

### Adding Authentication

For additional security, you can implement user authentication by integrating Passport.js:

1. Install required packages:

```bash
npm install passport passport-local express-session bcrypt
```

2. Follow the Passport.js documentation to add authentication to the Express app.

### Enabling Dark Mode

The UI is prepared for dark mode implementation. You can extend the Tailwind configuration to support a dark mode toggle.

## Troubleshooting

### Connection Issues

-   Verify your router credentials and IP address in the .env file
-   Make sure the target MAC address is correctly formatted
-   Check if your router's API endpoints match those used in the code

### Email Notification Problems

-   For Gmail, make sure to use an app password instead of your regular account password
-   Check spam folders if you're not receiving notifications

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgements

-   Express.js
-   MongoDB/Mongoose
-   Tailwind CSS
-   Nodemailer
-   EJS Templates
