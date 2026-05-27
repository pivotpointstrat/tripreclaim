const express = require('express');
const router = express.Router();
const AirlineCredit = require('../models/AirlineCredit');
const { requireAuth } = require('../middleware/auth');

// Airline slug map for policy page links
const POLICY_SLUGS = {
  AA: 'american-airlines', DL: 'delta-air-lines', UA: 'united-airlines',
  WN: 'southwest-airlines', B6: 'jetblue-airways', AS: 'alaska-airlines',
  BA: 'british-airways', LH: 'lufthansa', QR: 'qatar-airways',
  SQ: 'singapore-airlines', CX: 'cathay-pacific', AC: 'air-canada',
  KE: 'korean-air', EK: 'emirates', AF: 'air-france', TK: 'turkish-airlines',
  EY: 'etihad-airways', QF: 'qantas', HA: 'hawaiian-airlines', WS: 'westjet'
};

// GET /api/credits — list all user credits
router.get('/', requireAuth, async (req, res) => {
  try {
    const credits = await AirlineCredit.find({ userId: req.user._id }).sort({ expiryDate: 1 });
    // Auto-expire and add policy slug
    let changed = false;
    const result = credits.map(c => {
      if (c.checkAndExpire()) { c.save(); changed = true; }
      const obj = c.toJSON();
      obj.policySlug = POLICY_SLUGS[c.airlineCode] || null;
      return obj;
    });
    res.json({ credits: result, totalActive: result.filter(c => c.status === 'active').reduce((s, c) => s + c.amount, 0) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/credits — add a new credit
router.post('/', requireAuth, async (req, res) => {
  try {
    const { airline, airlineCode, amount, creditCode, issueDate, expiryDate, notes } = req.body;
    if (!airline || !airlineCode || !amount || !expiryDate) {
      return res.status(400).json({ error: 'airline, airlineCode, amount, expiryDate are required' });
    }
    const credit = new AirlineCredit({
      userId: req.user._id,
      airline, airlineCode: airlineCode.toUpperCase(), amount: parseFloat(amount),
      creditCode, issueDate: issueDate ? new Date(issueDate) : undefined,
      expiryDate: new Date(expiryDate), notes,
      history: [{ action: 'added', note: 'Credit added manually' }]
    });
    await credit.save();
    const obj = credit.toJSON();
    obj.policySlug = POLICY_SLUGS[credit.airlineCode] || null;
    res.json({ ok: true, credit: obj });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/credits/:id — update (mark used, edit)
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const credit = await AirlineCredit.findOne({ _id: req.params.id, userId: req.user._id });
    if (!credit) return res.status(404).json({ error: 'Credit not found' });
    const { status, usedAt, usedFor, notes, amount, expiryDate, creditCode } = req.body;
    if (status) {
      credit.status = status;
      if (status === 'used') {
        credit.usedAt = usedAt ? new Date(usedAt) : new Date();
        credit.usedFor = usedFor;
        credit.history.push({ action: 'marked_used', note: usedFor || 'Marked as used' });
      }
    }
    if (notes !== undefined) credit.notes = notes;
    if (amount !== undefined) credit.amount = parseFloat(amount);
    if (expiryDate) credit.expiryDate = new Date(expiryDate);
    if (creditCode !== undefined) credit.creditCode = creditCode;
    await credit.save();
    const obj = credit.toJSON();
    obj.policySlug = POLICY_SLUGS[credit.airlineCode] || null;
    res.json({ ok: true, credit: obj });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/credits/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await AirlineCredit.deleteOne({ _id: req.params.id, userId: req.user._id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
