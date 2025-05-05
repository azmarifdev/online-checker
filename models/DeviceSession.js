const mongoose = require('mongoose');

const DeviceSessionSchema = new mongoose.Schema(
    {
        macAddress: {
            type: String,
            required: true,
        },
        deviceName: {
            type: String,
            required: true,
        },
        onlineTime: {
            type: Date,
            required: true,
        },
        offlineTime: {
            type: Date,
            default: null,
        },
        duration: {
            type: Number, // Duration in minutes
            default: 0,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true },
);

// Add a method to calculate session duration
DeviceSessionSchema.methods.calculateDuration = function () {
    if (this.offlineTime && this.onlineTime) {
        // Calculate duration in minutes
        const durationMs = this.offlineTime - this.onlineTime;
        this.duration = Math.floor(durationMs / (1000 * 60));
        return this.duration;
    }
    return 0;
};

// Add a method to end the session
DeviceSessionSchema.methods.endSession = function () {
    this.offlineTime = new Date();
    this.isActive = false;
    this.calculateDuration();
};

module.exports = mongoose.model('DeviceSession', DeviceSessionSchema);
