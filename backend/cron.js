/**
 * TripReclaim — Price Monitoring Cron Job
 * 
 * Run this as a separate process on Railway (or as a scheduled job).
 * It wakes up every 30 minutes, checks which bookings are due,
 * and runs the monitoring cycle.
 * 
 * Deploy command: node cron.js
 */

require('dotenv').config();
const http = require('http');
const cron = require('node-cron');
const connectDB = require('./db');
const { runMonitoringCycle } = require('./services/alerts');

const start = async () => {
  // Minimal HTTP server so Railway health checks pass
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'TripReclaim Monitor', uptime: process.uptime() }));
  });
  server.listen(process.env.PORT || 3001, () => {
    console.log(`✅ Health server listening on port ${process.env.PORT || 3001}`);
  });

  console.log('🕐 TripReclaim Monitor starting...');
  await connectDB();

  // Run immediately on startup
  await runMonitoringCycle();

  // Then run every 30 minutes
  // Bookings track their own nextCheckAt, so this just polls frequently
  // and lets each booking decide if it's due based on adaptive schedule
  cron.schedule('*/30 * * * *', async () => {
    try {
      await runMonitoringCycle();
    } catch (err) {
      console.error('[cron] Monitoring cycle error:', err.message);
    }
  });

  console.log('✅ Monitor running — checking every 30 minutes');
  console.log('   Bookings use adaptive scheduling:');
  console.log('   • 30+ days out  → check once/day');
  console.log('   • 15–30 days    → check every 6 hours');
  console.log('   • 4–14 days     → check every 3 hours');
  console.log('   • 0–3 days      → check every hour');
};

start().catch(err => {
  console.error('❌ Failed to start monitor:', err.message);
  process.exit(1);
});

// Keep process alive
process.on('SIGTERM', () => {
  console.log('Monitor shutting down gracefully...');
  process.exit(0);
});
