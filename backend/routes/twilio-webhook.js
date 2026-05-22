const express = require('express');
const router = express.Router();
const User = require('../models/User');

/**
 * POST /webhooks/twilio
 * Handles inbound SMS replies from Twilio (STOP, HELP, etc.)
 * Twilio expects a TwiML response
 */
router.post('/twilio', express.urlencoded({ extended: false }), async (req, res) => {
  const { Body, From } = req.body;
  const msg = (Body || '').trim().toUpperCase();
  const phone = From || '';

  const twimlHeader = `<?xml version="1.0" encoding="UTF-8"?><Response>`;
  const twimlFooter = `</Response>`;

  try {
    // Handle STOP keywords — unsubscribe user from SMS
    if (['STOP', 'CANCEL', 'END', 'QUIT', 'UNSUBSCRIBE'].includes(msg)) {
      // Find user by phone number (normalize format)
      const normalizedPhone = phone.replace(/\D/g, '');
      const user = await User.findOne({
        $or: [
          { phone: phone },
          { phone: normalizedPhone },
          { phone: `+${normalizedPhone}` },
          { phone: normalizedPhone.replace(/^1/, '') },
        ]
      });

      if (user) {
        await User.findByIdAndUpdate(user._id, {
          $set: {
            'notificationPrefs.sms': false,
            smsConsentAt: null,
          }
        });
        console.log(`[twilio-webhook] SMS unsubscribe: ${phone} (user: ${user.email})`);
      } else {
        console.log(`[twilio-webhook] STOP received from unknown number: ${phone}`);
      }

      // Twilio handles the final STOP confirmation message automatically
      // Just return empty TwiML
      res.set('Content-Type', 'text/xml');
      return res.send(`${twimlHeader}${twimlFooter}`);
    }

    // Handle HELP keyword — send support info
    if (msg === 'HELP' || msg === 'INFO') {
      res.set('Content-Type', 'text/xml');
      return res.send(
        `${twimlHeader}<Message>TripReclaim: Flight price drop alerts from (888) 516-5777. For support visit tripreclaim.com or email hello@tripreclaim.com. Reply STOP to unsubscribe.</Message>${twimlFooter}`
      );
    }

    // For any other inbound message, send a gentle redirect
    res.set('Content-Type', 'text/xml');
    return res.send(
      `${twimlHeader}<Message>TripReclaim: This number sends flight price drop alerts only. Manage your alerts at tripreclaim.com/dashboard/ — Reply STOP to unsubscribe or HELP for support.</Message>${twimlFooter}`
    );

  } catch (err) {
    console.error('[twilio-webhook] Error:', err.message);
    res.set('Content-Type', 'text/xml');
    return res.send(`${twimlHeader}${twimlFooter}`);
  }
});

module.exports = router;
