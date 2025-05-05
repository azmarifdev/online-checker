const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/deviceController');

// Get current device status
router.get('/status', deviceController.getCurrentStatus);

// Get sessions for a specific day
router.get('/sessions/daily', deviceController.getDailySessions);

// Get sessions for a date range
router.get('/sessions/range', deviceController.getRangeSessions);

module.exports = router;
