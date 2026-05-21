const Booking = require('../models/Booking');
const { getLowestPrice } = require('./monitor');
const { sendPriceDropAlert } = require('./email');

/**
 * Check a single booking for a price drop.
 * Updates booking state and sends alert if threshold met.
 * Returns a result summary object.
 */
const checkBooking = async (booking) => {
  const result = {
    bookingId: booking._id,
    route: `${booking.origin}→${booking.destination}`,
    checked: false,
    currentPrice: null,
    dropped: false,
    alertSent: false,
    error: null,
  };

  try {
    const departureDate = booking.departureDate.toISOString().split('T')[0];
    const { price } = await getLowestPrice(
      booking.origin,
      booking.destination,
      departureDate,
      booking.airline,
      booking.cabinClass,
      booking.passengers
    );

    const now = new Date();
    result.checked = true;
    result.currentPrice = price;

    // Build update object
    const update = {
      lastCheckedAt: now,
    };

    if (price !== null) {
      // Track price history (keep last 90 entries)
      const historyEntry = { price, checkedAt: now };
      update.$push = {
        priceHistory: {
          $each: [historyEntry],
          $slice: -90,
        },
      };

      // Track lowest seen
      if (booking.lowestPriceSeen === null || price < booking.lowestPriceSeen) {
        update.lowestPriceSeen = price;
      }

      // Calculate price drop
      const drop = booking.pricePaid - price;
      const threshold = booking.dropThreshold || 10;

      // Alert if: drop meets threshold AND we haven't alerted for this price recently
      const shouldAlert =
        drop >= threshold &&
        (booking.lastAlertPrice === null || price < booking.lastAlertPrice - 5); // only alert again if price drops another $5

      if (shouldAlert) {
        try {
          await sendPriceDropAlert(booking.email, booking, price);
          update.alertsSent = (booking.alertsSent || 0) + 1;
          update.lastAlertAt = now;
          update.lastAlertPrice = price;
          result.dropped = true;
          result.alertSent = true;
          console.log(`[alerts] 💰 Alert sent for ${result.route} — $${booking.pricePaid} → $${price} (drop: $${drop.toFixed(2)})`);
        } catch (emailErr) {
          console.error(`[alerts] Failed to send alert email: ${emailErr.message}`);
        }
      } else if (drop >= threshold) {
        result.dropped = true; // drop detected but alert already sent for this price
      }
    }

    // Schedule next check
    const intervalMinutes = booking.getCheckIntervalMinutes
      ? booking.getCheckIntervalMinutes()
      : 1440;

    if (intervalMinutes === null) {
      // Travel date passed — expire this booking
      update.status = 'expired';
    } else {
      update.nextCheckAt = new Date(now.getTime() + intervalMinutes * 60 * 1000);
    }

    await Booking.findByIdAndUpdate(booking._id, update);

  } catch (err) {
    result.error = err.message;
    console.error(`[alerts] Error checking booking ${booking._id}: ${err.message}`);
  }

  return result;
};

/**
 * Run the monitoring cycle:
 * - Find all active bookings due for a check
 * - Group by route to batch API calls where possible
 * - Check each and send alerts
 */
const runMonitoringCycle = async () => {
  const now = new Date();
  console.log(`[alerts] Starting monitoring cycle at ${now.toISOString()}`);

  const bookings = await Booking.find({
    status: 'active',
    nextCheckAt: { $lte: now },
  }).lean({ getters: true });

  if (!bookings.length) {
    console.log('[alerts] No bookings due for check');
    return { checked: 0, alerts: 0 };
  }

  console.log(`[alerts] Checking ${bookings.length} booking(s)`);

  let checked = 0;
  let alerts = 0;

  // Process sequentially to respect API rate limits
  for (const booking of bookings) {
    // Skip if travel date has passed
    const daysLeft = Math.ceil((new Date(booking.departureDate) - now) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 0) {
      await Booking.findByIdAndUpdate(booking._id, { status: 'expired' });
      continue;
    }

    const result = await checkBooking(booking);
    if (result.checked) checked++;
    if (result.alertSent) alerts++;

    // Small delay between calls to be a good API citizen
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[alerts] Cycle complete — checked: ${checked}, alerts sent: ${alerts}`);
  return { checked, alerts };
};

module.exports = { checkBooking, runMonitoringCycle };
