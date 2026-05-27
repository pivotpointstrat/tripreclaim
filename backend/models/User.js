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
    enum: ['per_trip', 'monthly', 'annual', 'trial', 'lead', null],
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
  trialExpiresAt: {
    type: Date,
    default: null,
  },
  trialOrigin: { type: String, default: null },
  trialDestination: { type: String, default: null },
  trialDepartureDate: { type: String, default: null },
  trialPricePaid: { type: Number, default: null },
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
  smsConsentAt: {
    type: Date,
    default: null,
  },
  smsConsentIp: {
    type: String,
    default: null,
  },
  onboardingEmailStep: {
    type: Number,
    default: 0,
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
  // Account credit system (earned via referrals, redeemable on monthly/annual plans only)
  accountCredit: {
    type: Number,
    default: 0,
  },
  creditHistory: [{
    amount: { type: Number },
    creditType: { type: String, enum: ['referral_earned', 'credit_applied', 'expired'] },
    description: { type: String },
    referredEmail: { type: String },
    expiresAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
  }],
}, {
  timestamps: true,
});

userSchema.index({ email: 1 });
userSchema.index({ stripeCustomerId: 1 });

module.exports = mongoose.model('User', userSchema);
