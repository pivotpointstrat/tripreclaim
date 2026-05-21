const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  stripeCustomerId: {
    type: String,
    default: null,
  },
  plan: {
    type: String,
    enum: ['per_trip', 'monthly', 'annual', null],
    default: null,
  },
  planStatus: {
    type: String,
    enum: ['active', 'canceled', 'past_due', null],
    default: null,
  },
  stripeSubscriptionId: {
    type: String,
    default: null,
  },
  // For per_trip: track remaining trips
  tripsRemaining: {
    type: Number,
    default: 0,
  },
  // Magic link token (hashed)
  magicToken: {
    type: String,
    default: null,
  },
  magicTokenExpiry: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lastLoginAt: {
    type: Date,
    default: null,
  },
  // Profile
  name: {
    type: String,
    default: null,
    trim: true,
  },
  phone: {
    type: String,
    default: null,
    trim: true,
  },
  notificationPrefs: {
    email: { type: Boolean, default: true },
    sms: { type: Boolean, default: false },
    dropThresholdDefault: { type: Number, default: 10 },
  },
  onboardingComplete: {
    type: Boolean,
    default: false,
  },
  // Referral program
  referralCode: {
    type: String,
    default: null,
    unique: true,
    sparse: true,
  },
  referredBy: {
    type: String,
    default: null,
  },
  referralCount: {
    type: Number,
    default: 0,
  },
  referralTripsEarned: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
});

userSchema.index({ email: 1 });
userSchema.index({ stripeCustomerId: 1 });

module.exports = mongoose.model('User', userSchema);
