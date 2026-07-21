const webpush = require('web-push');

const VAPID_PUBLIC_KEY = 'BOIMSoH3ZuHz_eL09w-2cOw7FSGyTTew3q3XlJsuwe4yBvnEbi1ee3mnwz3hOvS4rA_SigRsest_GbV_KgLZPV8';
const VAPID_PRIVATE_KEY = '2oC4anJ19gv8ylo1D2XBDBWuiBiXfvnu6OzI-rIeE5E';

webpush.setVapidDetails(
  'mailto:saud.alh6@gmail.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { subscription, title, body, url } = JSON.parse(event.body);

    if (!subscription || !subscription.endpoint) {
      return { statusCode: 400, body: 'Missing subscription' };
    }

    const payload = JSON.stringify({ title: title || 'رسالة جديدة', body: body || '', url: url || '/' });

    await webpush.sendNotification(subscription, payload);
    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      return { statusCode: 410, body: 'Subscription expired' };
    }
    return { statusCode: 500, body: 'Push failed' };
  }
};
