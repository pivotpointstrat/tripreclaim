const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  email:    { type: String, required: true, index: true },
  endpoint: { type: String, required: true, unique: true },
  keys: {
    p256dh: { type: String, required: true },
    auth:   { type: String, required: true },
  },
  userAgent: { type: String },
  active:    { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  lastUsedAt:{ type: Date },
});

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
