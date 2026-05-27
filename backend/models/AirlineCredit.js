const mongoose = require('mongoose');

const creditHistorySchema = new mongoose.Schema({
  action: String,       // 'added', 'marked_used', 'expiry_reminder_sent'
  date: { type: Date, default: Date.now },
  note: String
});

const airlineCreditSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  airline:      { type: String, required: true },
  airlineCode:  { type: String, required: true, uppercase: true },
  amount:       { type: Number, required: true },
  currency:     { type: String, default: 'USD' },
  creditCode:   { type: String },             // the code from the airline e.g. ZXKP2019DL
  issueDate:    { type: Date },
  expiryDate:   { type: Date, required: true, index: true },
  status:       { type: String, enum: ['active','used','expired'], default: 'active', index: true },
  notes:        { type: String },             // e.g. "from JFK-LAX cancellation May 2025"
  usedAt:       { type: Date },
  usedFor:      { type: String },             // e.g. "ORD to MIA Jan 2027"
  remindersSent: { type: [Number], default: [] }, // days: [90, 30, 7, 0]
  history:      [creditHistorySchema]
}, { timestamps: true });

// Virtual: days remaining until expiry
airlineCreditSchema.virtual('daysRemaining').get(function() {
  if (this.status !== 'active') return null;
  const now = new Date();
  const diff = this.expiryDate - now;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
});

// Auto-expire credits past expiry date
airlineCreditSchema.methods.checkAndExpire = function() {
  if (this.status === 'active' && new Date() > this.expiryDate) {
    this.status = 'expired';
    return true;
  }
  return false;
};

airlineCreditSchema.set('toJSON', { virtuals: true });
airlineCreditSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('AirlineCredit', airlineCreditSchema);
