const Booking = require('../models/Booking');
const { getLowestPrice } = require('./monitor');
const { sendPriceDropAlert } = require('./email');
const { getPolicyForAirline } = require('./policyAgent');

// Map airline display names → IATA codes for policy lookup
const AIRLINE_TO_CODE = {
  'American Airlines': 'AA',
  'Delta Air Lines':   'DL',
  'United Airlines':   'UA',
  'Southwest Airlines': 'WN',
  'JetBlue':           'B6',
  'Alaska Airlines':   'AS',
  'Lufthansa':         'LH',
  'British Airways':   'BA',
  'Qatar Airways':     'QR',
};

/**
 * Calculate net savings after subtracting applicable cancellation fees.
 * For JetBlue Basic: subtract the relevant fee before deciding to alert.
 * Returns the net saving amount (can be negative — don't alert if so).
 */
const calculateNetSavings = async (booking, priceDrop) => {
  if (booking.bookingType !== 'cash') return priceDrop; // miles/points handled separately

  const airlineCode = AIRLINE_TO_CODE[booking.airline] || booking.airline.toUpperCase().slice(0, 2);
  const policy = await getPolicyForAirline(airlineCode);

  if (!policy || !policy.policies || !policy.policies.cancellationFees) {
    return priceDrop; // no fee data — assume full savings
  }

  const fees = policy.policies.cancellationFees; // Map or plain object
  const getMapValue = (key) => {
    if (fees instanceof Map) return fees.get(key) || 0;
    return fees[key] || 0;
  };

  // JetBlue Blue Basic: subtract cancellation fee
  if (booking.cabinClass === 'basic_economy') {
    const fee = booking.international
      ? getMapValue('blueBasicInternational')
      : getMapValue('blueBasic');
    return priceDrop - fee;
  }

  return priceDrop;
};

/**
 * Build a human-readable miles drop description for award tickets.
 */
const buildMilesDropMessage = (booking, currentMilesCost) => {
  const program = booking.milesProgram || 'miles';
  const drop = booking.milesPaid - currentMilesCost;
  return `Your ${program} award ticket dropped ${drop.toLocaleString()} miles`;
};

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

      // ── Miles / award booking: compare miles cost ──
      if (booking.bookingType !== 'cash' && booking.milesPaid) {
        // SerpAPI returns dollar price; we can't directly compare miles here.
        // Log for now and skip dollar-based alerting for miles bookings.
        // A future iteration will integrate a miles-valuation layer.
        console.log(
          `[alerts] Miles booking ${booking._id}: current price $${price} ` +
          `(paid ${booking.milesPaid} ${booking.milesProgram || 'miles'}) — skipping dollar alert`
        );
        // Still schedule next check
      } else {
        // ── Cash booking: calculate price drop ──
        const rawDrop = booking.pricePaid - price;
        const threshold = booking.dropThreshold || 10;

        if (rawDrop >= threshold) {
          // Calculate net savings after fees
          const netSavings = await calculateNetSavings(booking, rawDrop);

          if (netSavings <= 0) {
            // Drop detected but fees eat all savings — send a "not worth it" alert
            // only if we haven't already sent one for this level
            const alreadyNotified = booking.lastAlertPrice !== null &&
              price >= booking.lastAlertPrice - 5;

            if (!alreadyNotified) {
              try {
                await sendPriceDropAlert(booking.email, booking, price, {
                  netSavings,
                  rawDrop,
                  notWorthClaiming: true,
                });
                update.alertsSent = (booking.alertsSent || 0) + 1;
                update.lastAlertAt = now;
                update.lastAlertPrice = price;
                result.alertSent = true;
                console.log(
                  `[alerts] ⚠️  Drop not worth claiming for ${result.route} — ` +
                  `drop $${rawDrop.toFixed(2)}, fee eats savings`
                );
              } catch (emailErr) {
                console.error(`[alerts] Failed to send not-worth-it alert: ${emailErr.message}`);
              }
            }
          } else {
            // Net savings are positive — alert if we haven't already for this price
            const shouldAlert =
              booking.lastAlertPrice === null ||
              price < booking.lastAlertPrice - 5;

            if (shouldAlert) {
              try {
                await sendPriceDropAlert(booking.email, booking, price, {
                  netSavings,
                  rawDrop,
                  notWorthClaiming: false,
                });
                update.alertsSent = (booking.alertsSent || 0) + 1;
                update.lastAlertAt = now;
                update.lastAlertPrice = price;
                result.dropped = true;
                result.alertSent = true;
                console.log(
                  `[alerts] 💰 Alert sent for ${result.route} — ` +
                  `$${booking.pricePaid} → $${price} ` +
                  `(gross drop: $${rawDrop.toFixed(2)}, net: $${netSavings.toFixed(2)})`
                );
              } catch (emailErr) {
                console.error(`[alerts] Failed to send alert email: ${emailErr.message}`);
              }
            } else {
              result.dropped = true; // drop detected, alert already sent
            }
          }
        }
      }
    }

    // Schedule next check using the updated 24h front-loaded model
    // NOTE: lean() objects don't have methods — reconstruct interval from timestamps
    const intervalMinutes = _getCheckIntervalMinutes(
      booking.createdAt,
      booking.departureDate
    );

    if (intervalMinutes === null) {
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
 * Pure function mirror of Booking.methods.getCheckIntervalMinutes.
 * Used here because runMonitoringCycle uses lean() objects (no instance methods).
 */
const _getCheckIntervalMinutes = (createdAt, departureDate) => {
  const now = new Date();
  const daysUntilDeparture = Math.ceil((new Date(departureDate) - now) / (1000 * 60 * 60 * 24));

  if (daysUntilDeparture <= 0) return null; // expired

  const hoursSinceBooking = (now - new Date(createdAt)) / (1000 * 60 * 60);

  // 24-hour front-loaded window
  if (hoursSinceBooking < 1)  return 15;
  if (hoursSinceBooking < 6)  return 30;
  if (hoursSinceBooking < 24) return 60;

  // After 24h: adaptive
  if (daysUntilDeparture <= 3)  return 60;
  if (daysUntilDeparture <= 14) return 180;
  if (daysUntilDeparture <= 30) return 360;
  return 1440;
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

module.exports = { checkBooking, runMonitoringCycle, calculateNetSavings, _getCheckIntervalMinutes };
