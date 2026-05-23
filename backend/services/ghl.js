/**
 * GHL (GoHighLevel) Integration Service
 * Creates and updates CRM contacts when users sign up and create bookings.
 */
const axios = require('axios');

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

function ghlHeaders() {
  return {
    'Authorization': `Bearer ${process.env.GHL_PRIVATE_KEY}`,
    'Version': GHL_VERSION,
    'Content-Type': 'application/json',
  };
}

/**
 * Search for an existing GHL contact by email.
 */
async function findContact(email) {
  try {
    const r = await axios.get(`${GHL_BASE}/contacts/`, {
      headers: ghlHeaders(),
      params: { locationId: process.env.GHL_LOCATION_ID, query: email },
      timeout: 10000,
    });
    const contacts = r.data?.contacts || [];
    return contacts.find(c => c.email?.toLowerCase() === email.toLowerCase()) || null;
  } catch (err) {
    console.error('[ghl] findContact error:', err.response?.data || err.message);
    return null;
  }
}

/**
 * Create a new GHL contact.
 */
async function createContact(data) {
  try {
    const r = await axios.post(`${GHL_BASE}/contacts/`, {
      locationId: process.env.GHL_LOCATION_ID,
      email: data.email,
      firstName: data.firstName || '',
      lastName: data.lastName || '',
      phone: data.phone || '',
      tags: data.tags || [],
      source: 'TripReclaim',
      customFields: data.customFields || [],
    }, { headers: ghlHeaders(), timeout: 10000 });
    console.log('[ghl] Contact created:', r.data?.contact?.id, data.email);
    return r.data?.contact || null;
  } catch (err) {
    console.error('[ghl] createContact error:', err.response?.data || err.message);
    return null;
  }
}

/**
 * Update an existing GHL contact.
 */
async function updateContact(contactId, data) {
  try {
    const r = await axios.put(`${GHL_BASE}/contacts/${contactId}`, {
      ...data,
    }, { headers: ghlHeaders(), timeout: 10000 });
    console.log('[ghl] Contact updated:', contactId);
    return r.data?.contact || null;
  } catch (err) {
    console.error('[ghl] updateContact error:', err.response?.data || err.message);
    return null;
  }
}

/**
 * Add a note to a GHL contact.
 */
async function addNote(contactId, body) {
  try {
    await axios.post(`${GHL_BASE}/contacts/${contactId}/notes`, {
      body,
      userId: contactId, // required by GHL
    }, { headers: ghlHeaders(), timeout: 10000 });
    console.log('[ghl] Note added to:', contactId);
  } catch (err) {
    console.error('[ghl] addNote error:', err.response?.data || err.message);
  }
}

/**
 * Main function: find or create a GHL contact from a TripReclaim user/purchase event.
 * Call this from Stripe webhook (checkout.session.completed) and booking creation.
 *
 * @param {object} opts
 * @param {string} opts.email
 * @param {string} [opts.name]
 * @param {string} [opts.phone]
 * @param {string} [opts.plan] — per_trip | monthly | annual
 * @param {string} [opts.note]
 * @param {string[]} [opts.extraTags]
 */
async function upsertContact({ email, name, phone, plan, note, extraTags = [] }) {
  if (!email) return null;

  const nameParts = (name || '').trim().split(' ');
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';

  const planTag = plan ? `plan:${plan}` : null;
  const tags = ['triprelaim-user', planTag, ...extraTags].filter(Boolean);

  let contact = await findContact(email);

  if (!contact) {
    contact = await createContact({ email, firstName, lastName, phone, tags });
  } else {
    // Update plan tag if changed
    const existingTags = contact.tags || [];
    const mergedTags = Array.from(new Set([...existingTags.filter(t => !t.startsWith('plan:')), ...tags]));
    await updateContact(contact.id, {
      firstName: firstName || contact.firstName,
      lastName: lastName || contact.lastName,
      phone: phone || contact.phone,
      tags: mergedTags,
    });
  }

  if (contact && note) {
    await addNote(contact.id, note);
  }

  return contact;
}


/**
 * Add tags to an existing GHL contact.
 */
async function addTags(contactId, tags) {
  try {
    const r = await axios.post(`${GHL_BASE}/contacts/${contactId}/tags`, {
      tags,
    }, { headers: ghlHeaders(), timeout: 10000 });
    console.log('[ghl] Tags added to', contactId, ':', tags);
    return r.data;
  } catch (err) {
    console.error('[ghl] addTags error:', err.response?.data || err.message);
  }
}

/**
 * Trigger a price drop event on a GHL contact.
 * Adds tags and a note when TripReclaim detects a lower fare.
 *
 * @param {string} email - user email
 * @param {object} booking - { airline, origin, destination, departureDate, pricePaid }
 * @param {number} currentPrice - the detected lower price
 * @param {number} savings - how much the user saves
 * @param {boolean} isIn24h - whether within the 24h DOT refund window
 */
async function triggerPriceDropEvent(email, booking, currentPrice, savings, isIn24h) {
  if (!email) return;
  try {
    const contact = await findContact(email);
    if (!contact) {
      console.log('[ghl] triggerPriceDropEvent: no contact found for', email);
      return;
    }

    const savingsFormatted = savings.toFixed(2);
    const route = `${booking.origin || '?'}-${booking.destination || '?'}`;
    const windowLabel = isIn24h ? '24h-window' : 'post-24h';

    // Add actionable tags
    await addTags(contact.id, [
      'price-drop-detected',
      `savings:$${Math.floor(savings)}`,
      `route:${route.toLowerCase()}`,
      `airline:${(booking.airline || 'unknown').toLowerCase().replace(/\s+/g, '-')}`,
      `window:${windowLabel}`,
    ]);

    // Add timestamped note
    const noteDate = new Date().toISOString().split('T')[0];
    const noteBody = [
      `💰 Price Drop Detected — ${noteDate}`,
      `Route: ${booking.origin} → ${booking.destination}`,
      `Airline: ${booking.airline || 'Unknown'}`,
      `Departure: ${booking.departureDate ? new Date(booking.departureDate).toLocaleDateString() : 'Unknown'}`,
      `Paid: $${Number(booking.pricePaid || 0).toFixed(2)} → Now: $${Number(currentPrice).toFixed(2)}`,
      `Savings: $${savingsFormatted}`,
      `Window: ${isIn24h ? '✅ Within 24h (full cash refund eligible)' : '⏰ Outside 24h (price adjustment/credit)'}`,
    ].join('\n');

    await addNote(contact.id, noteBody);
    console.log(`[ghl] Price drop event recorded for ${email} — savings: $${savingsFormatted}`);
  } catch (err) {
    console.error('[ghl] triggerPriceDropEvent error:', err.message);
  }
}

/**
 * Mark a contact as churned (plan expired / cancelled).
 */
async function markChurned(email, reason) {
  if (!email) return;
  try {
    const contact = await findContact(email);
    if (!contact) return;
    await addTags(contact.id, ['churned', `churn-reason:${reason || 'unknown'}`]);
    await addNote(contact.id, `❌ Churn event — ${new Date().toISOString().split('T')[0]}: ${reason || 'plan expired'}`);
    console.log('[ghl] Contact marked churned:', email);
  } catch (err) {
    console.error('[ghl] markChurned error:', err.message);
  }
}

module.exports = { upsertContact, findContact, createContact, updateContact, addNote, addTags, triggerPriceDropEvent, markChurned };
