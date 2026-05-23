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

module.exports = { upsertContact, findContact, createContact, updateContact, addNote };
