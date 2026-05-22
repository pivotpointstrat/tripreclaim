const mongoose = require('mongoose');

const priceHistorySchema = new mongoose.Schema({
  price: { type: Number, required: true },
  checkedAt: { type: Date, default: Date.now },
}, { _id: false });

const bookingSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  email: {
    type: String,
    required: true,
  },

  // Flight details
  airline: { type: String, required: true },
  origin: { type: String, required: true, uppercase: true, trim: true },       // IATA code e.g. JFK
  destination: { type: String, required: true, uppercase: true, trim: true }, // IATA code e.g. LAX
  departureDate: { type: Date, required: true },
  returnDate: { type: Date, default: null },
  isRoundTrip: { type: Boolean, default: false },
  cabinClass: {
    type: String,
    enum: ['economy', 'premium_economy', 'business', 'first', 'basic_economy'],
    default: 'economy',
  },
  passengers: { type: Number, default: 1, min: 1, max: 9 },

  // Pricing
  pricePaid: { type: Number, required: true },       // $ amount paid
  currency: { type: String, default: 'USD' },
  dropThreshold: { type: Number, default: 10 },      // min $ drop to alert
  lowestPriceSeen: { type: Number, default: null },

  // Award / miles booking support
  bookingType: {
    type: String,
    enum: ['cash', 'miles', 'points'],
    default: 'cash',
  },
  milesPaid:    { type: Number, default: null },   // miles/points paid for award booking
  milesProgram: { type: String, default: null },   // e.g. 'SkyMiles', 'MileagePlus', 'AAdvantage'

  // Travel credit tracking (after user claims a price-drop refund)
  creditClaimed:     { type: Boolean, default: false },
  creditAmount:      { type: Number, default: null },
  creditExpiryDate:  { type: Date,   default: null },
  creditClaimedAt:   { type: Date,   default: null },

  // Booking reference (optional but useful)
  confirmationNumber: { type: String, default: null },
  flightNumber: { type: String, default: null },
  matchMode: { type: String, enum: ['exact', 'flexible'], default: 'exact' },
  monitoringPrefs: {
    flightNumber: String,
    maxStops: { type: Number, default: 0 },
    timeWindow: { type: String, default: '2h' },
    airlinePreference: { type: String, default: 'same' },
  },

  // Monitoring state
  status: {
    type: String,
    enum: ['active', 'paused', 'completed', 'expired'],
    default: 'active',
  },
  lastCheckedAt: { type: Date, default: null },
  nextCheckAt: { type: Date, default: Date.now },
  alertsSent: { type: Number, default: 0 },
  lastAlertAt: { type: Date, default: null },
  lastAlertPrice: { type: Number, default: null },

  // Price history (last 90 data points)
  priceHistory: {
    type: [priceHistorySchema],
    default: [],
  },

  // Plan snapshot at time of booking
  planAtBooking: { type: String,
    enum: ['per_trip', 'monthly', 'annual'],
    required: true,
  },
  parsedFrom:      { type: String, default: null },
  parseConfidence: { type: Number, default: null },
}, {
  timestamps: true,
});

// Index for efficient monitoring queries
bookingSchema.index({ status: 1, nextCheckAt: 1 });
bookingSchema.index({ userId: 1 });
bookingSchema.index({ email: 1 });
// Compound index for route batching (multiple users watching same route)
bookingSchema.index({ origin: 1, destination: 1, departureDate: 1, status: 1 });

// Virtual: days until departure
bookingSchema.virtual('daysUntilDeparture').get(function () {
  const now = new Date();
  const diff = this.departureDate - now;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
});

// Method: calculate next check interval based on days until departure
// Method: calculate next check interval.
// Front-loads monitoring during first 24h post-booking for maximum price-drop capture,
// then falls back to adaptive scheduling based on days-to-departure.
bookingSchema.methods.getCheckIntervalMinutes = function () {
  const days = this.daysUntilDeparture;
  if (days <= 0) return null; // flight has departed — expire

  const now = new Date();
  const hoursSinceBooking = (now - this.createdAt) / (1000 * 60 * 60);

  // ── 24-hour front-loaded window ──
  if (hoursSinceBooking < 1)  return 15;   // first hour: every 15 min
  if (hoursSinceBooking < 6)  return 30;   // hours 1-6:  every 30 min
  if (hoursSinceBooking < 24) return 60;   // hours 6-24: every hour

  // ── After 24h: adaptive by days-to-departure ──
  if (days <= 3)  return 60;    // 0-3 days:   every hour
  if (days <= 14) return 180;   // 4-14 days:  every 3 hours
  if (days <= 30) return 360;   // 15-30 days: every 6 hours
  return 1440;                  // 30+ days:   once daily
};

module.exports = mongoose.model('Booking', bookingSchema);
