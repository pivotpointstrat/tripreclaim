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
    enum: ['economy', 'premium_economy', 'business', 'first'],
    default: 'economy',
  },
  passengers: { type: Number, default: 1, min: 1, max: 9 },

  // Pricing
  pricePaid: { type: Number, required: true },       // $ amount paid
  currency: { type: String, default: 'USD' },
  dropThreshold: { type: Number, default: 10 },      // min $ drop to alert
  lowestPriceSeen: { type: Number, default: null },

  // Booking reference (optional but useful)
  confirmationNumber: { type: String, default: null },

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
  planAtBooking: {
    type: String,
    enum: ['per_trip', 'monthly', 'annual'],
    required: true,
  },
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
bookingSchema.methods.getCheckIntervalMinutes = function () {
  const days = this.daysUntilDeparture;
  if (days <= 0) return null;        // expired
  if (days <= 3) return 60;          // every 1 hour
  if (days <= 14) return 180;        // every 3 hours
  if (days <= 30) return 360;        // every 6 hours
  return 1440;                        // once daily
};

module.exports = mongoose.model('Booking', bookingSchema);
