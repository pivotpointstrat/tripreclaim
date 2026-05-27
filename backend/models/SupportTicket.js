const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema({
  // Submitter info
  email: { type: String, required: true, lowercase: true, trim: true },
  name:  { type: String, default: null, trim: true },

  // Ticket details
  category: {
    type: String,
    enum: ['account_access', 'billing', 'monitoring', 'claim_help', 'general'],
    default: 'general',
  },
  subject:  { type: String, required: true, trim: true },
  message:  { type: String, required: true, trim: true },

  // Ticket lifecycle
  status: {
    type: String,
    enum: ['open', 'agent_replied', 'escalated', 'resolved', 'closed'],
    default: 'open',
  },
  ticketNumber: { type: Number, unique: true },

  // Agent / AI response
  agentResponse:    { type: String, default: null },
  agentRespondedAt: { type: Date,   default: null },
  autoResolved:     { type: Boolean, default: false }, // resolved by AI without human

  // Escalation
  escalated:        { type: Boolean, default: false },
  escalatedAt:      { type: Date,   default: null },
  escalationReason: { type: String, default: null },
  escalationNotifiedAt: { type: Date, default: null },

  // Resolution
  resolvedAt:       { type: Date, default: null },
  resolutionNote:   { type: String, default: null },

  // Meta
  userId:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  ipAddress:        { type: String, default: null },
  userAgent:        { type: String, default: null },
}, {
  timestamps: true,
});

// Auto-increment ticket number
supportTicketSchema.pre('save', async function(next) {
  if (this.isNew) {
    const last = await this.constructor.findOne({}, {}, { sort: { ticketNumber: -1 } });
    this.ticketNumber = last ? last.ticketNumber + 1 : 1000;
  }
  next();
});

supportTicketSchema.index({ email: 1 });
supportTicketSchema.index({ status: 1 });
supportTicketSchema.index({ ticketNumber: 1 });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
