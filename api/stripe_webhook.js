import Stripe from 'stripe';

export const config = {
  api: {
    bodyParser: false,
  },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function generatePasscode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const randPart = (len) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `NC-${randPart(4)}-${randPart(4)}`;
}

async function kvCommand(commandArray) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const res = await fetch(`${url}/${commandArray.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data.result;
}

async function sendPasscodeEmail(toEmail, code, appName) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !toEmail || toEmail === '(メール不明)') return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
        to: [toEmail],
        subject: `【${appName}】ご契約ありがとうございます（パスコードのお知らせ）`,
        html: `
          <div style="font-family:sans-serif; max-width:480px; margin:0 auto; padding:20px;">
            <h2>ご契約ありがとうございます！</h2>
            <p>${appName} をご利用いただき、誠にありがとうございます。</p>
            <p>以下のパスコードを、アプリの「設定」→「APIキー設定」欄に入力してください。</p>
            <div style="background:#F4F6F4; border-radius:10px; padding:20px; text-align:center; margin:20px 0;">
              <div style="font-family:monospace; font-size:22px; font-weight:bold; letter-spacing:2px;">${code}</div>
            </div>
            <p style="font-size:13px; color:#666;">
              ※初めてのご契約の方は、ご自身でAnthropic社のAPIキーを取得し、あわせて設定していただく必要があります。
              APIキーをまだ設定済みの方は、パスコードの入力だけで継続してご利用いただけます。
            </p>
            <p style="font-size:13px; color:#666;">
              ご不明点があれば、LINE公式アカウントまでお気軽にご連絡ください。
            </p>
          </div>
        `,
      }),
    });
  } catch (err) {
    console.error('Email send failed:', err.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  if (event.type === 'checkout.session.completed' || event.type === 'invoice.payment_succeeded') {
    try {
      const obj = event.data.object;

      const dedupeId = obj.invoice || obj.id;
      const dedupeKey = `webhook_processed:${dedupeId}`;
      // SET ... NX EX は「まだキーが存在しない時だけ設定する」というアトミックな操作。
      // これにより、ほぼ同時に2つの通知が来ても、片方しか処理が通らないようにする。
      const setResult = await kvCommand(['SET', dedupeKey, '1', 'NX', 'EX', '2592000']);
      if (setResult !== 'OK') {
        res.status(200).json({ received: true, skipped: 'duplicate' });
        return;
      }

      const customerEmail = obj.customer_details?.email || obj.customer_email || '(メール不明)';
      const code = generatePasscode();
      const now = new Date();
      const stamp = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      const amountTotal = obj.amount_total ?? obj.amount_paid ?? obj.total ?? 0;
      const tier = amountTotal > 0 && amountTotal < 600 ? 'basic' : 'valid';

      await kvCommand(['SET', `passcode:${code}`, tier]);

      const listKey = 'passcode_list';
      let list = [];
      try {
        const existing = await kvCommand(['GET', listKey]);
        list = existing ? JSON.parse(existing) : [];
      } catch (e) {}
      list.unshift({ code, email: customerEmail, stamp, tier });
      list = list.slice(0, 50);
      await kvCommand(['SET', listKey, JSON.stringify(list)]);

      await sendPasscodeEmail(customerEmail, code, process.env.APP_DISPLAY_NAME || 'アプリ');

      console.log(`New passcode issued: ${code} (${tier}) for ${customerEmail}`);
    } catch (err) {
      console.error('Error issuing passcode:', err.message);
    }
  }

  res.status(200).json({ received: true });
}
