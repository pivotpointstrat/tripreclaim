const mongoose = require('mongoose');

const airlinePolicySchema = new mongoose.Schema({
  airline: { type: String, required: true },          // Display name e.g. "United Airlines"
  code:    { type: String, required: true, uppercase: true, index: true, unique: true }, // IATA e.g. "UA"

  lastScraped: { type: Date, default: null },

  policies: {
    // Core price-drop policy description
    priceDropPolicy: { type: String, default: '' },

    // DOT 24-hour rule support
    twentyFourHourRule: { type: String, default: '' },

    // Basic economy restrictions
    basicEconomyRules: { type: String, default: '' },

    // Award / miles ticket policy
    awardTicketPolicy: { type: String, default: '' },

    // Numbered steps user should follow to claim credit
    claimSteps: [{ type: String }],

    // Direct URL to airline claim / rebooking tool
    claimUrl: { type: String, default: '' },

    // Phone number for claims
    claimPhone: { type: String, default: '' },

    // How long travel credits last (e.g. "1 year from ticket issue date")
    creditExpiry: { type: String, default: '' },

    // Cancellation fee schedule (keyed by fare type)
    cancellationFees: {
      type: Map,
      of: String,
      default: {},
    },

    // Known loopholes / tips that benefit the traveler
    loopholes: [{ type: String }],
  },

  // Flag set when a scrape detects a change vs. the previous stored version
  changeDetectedAt: { type: Date, default: null },
}, {
  timestamps: true,
});

airlinePolicySchema.index({ code: 1 });
airlinePolicySchema.index({ airline: 'text' });  // text search by name

module.exports = mongoose.model('AirlinePolicy', airlinePolicySchema);
