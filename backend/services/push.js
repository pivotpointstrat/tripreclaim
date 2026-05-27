const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:info@tripreclaim.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

/**
 * Send push notification to all active subscriptions for a userId
 */
const sendPushToUser = async (userId, title, body, url = 'https://tripreclaim.com/dashboard/') => {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  try {
    const subs = await PushSubscription.find({ userId, active: true }).lean();
    if (!subs.length) return;
    const payload = JSON.stringify({ title, body, url, icon: '/logos/favicon.png', badge: '/logos/favicon.png' });
    await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload)
          .then(() => PushSubscription.findByIdAndUpdate(sub._id, { lastUsedAt: new Date() }).catch(() => {}))
          .catch(async err => {
            if (err.statusCode === 410 || err.statusCode === 404) {
              await PushSubscription.findByIdAndUpdate(sub._id, { active: false });
            } else {
              console.warn('[push] Send failed:', err.message);
            }
          })
      )
    );
    console.log(`[push] Sent to ${subs.length} subscription(s) for user ${userId}`);
  } catch (err) {
    console.warn('[push] sendPushToUser error:', err.message);
  }
};

/**
 * Send push notification by email address
 */
const sendPushByEmail = async (email, title, body, url) => {
  try {
    const User = require('../models/User');
    const user = await User.findOne({ email: email.toLowerCase() }).lean();
    if (!user) return;
    await sendPushToUser(user._id, title, body, url);
  } catch (err) {
    console.warn('[push] sendPushByEmail error:', err.message);
  }
};

module.exports = { sendPushToUser, sendPushByEmail };
