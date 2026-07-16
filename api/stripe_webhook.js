// api/stripe_webhook.js
// Stripeの決済完了イベントを受け取り、自動でランダムなパスコードを発行してVercel KVに保存し、
// お客様のメールアドレスに自動でパスコードを送信する。
// 丹羽さんは admin_codes.js（管理用ページ）で発行履歴を確認できる（バックアップ用）。

import Stripe from 'stripe';

export const config = {
  api: {
    bodyParser: false, // Stripeの署名検証には「生のボディ」が必要なため、自動パースを無効化
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
  // 例: NC-8F2K-93XL のような読みやすいランダムコード
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい文字(0,O,1,I)は除外
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

  // 決済完了・サブスク更新のイベントで、新しいパスコードを発行する
  if (event.type === 'checkout.session.completed' || event.type === 'invoice.payment_succeeded') {
    try {
      const obj = event.data.object;

      // ── 重複防止：同じ請求書(invoice)由来のイベントで2重発行しないようにする ──
      // checkout.session.completed には invoice ID が含まれることがあり、
      // それに対応する invoice.payment_succeeded も別途発生するため、片方だけ処理する。
      const dedupeId = obj.invoice || obj.id; // invoice IDがあればそれを優先、なければセッション/請求書自体のID
      const dedupeKey = `webhook_processed:${dedupeId}`;
      const alreadyProcessed = await kvCommand(['GET', dedupeKey]);
      if (alreadyProcessed) {
        res.status(200).json({ received: true, skipped: 'duplicate' });
        return;
      }
      await kvCommand(['SET', dedupeKey, '1']);
      await kvCommand(['EXPIRE', dedupeKey, '2592000']); // 30日で自動削除

      const customerEmail = obj.customer_details?.email || obj.customer_email || '(メール不明)';
      const code = generatePasscode();
      const now = new Date();
      const stamp = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      // 決済金額からプランを判定（600円未満なら「プチ課金＝basic」、それ以上なら「本契約＝valid」）
      // ※JPYは0桁通貨のため、Stripeのamount_totalは実際の円数がそのまま入る（例:500円→500）
      const amountTotal = obj.amount_total ?? obj.amount_paid ?? obj.total ?? 0;
      const tier = amountTotal > 0 && amountTotal < 600 ? 'basic' : 'valid';

      // 有効なコードとして保存（アプリ側の照合に使う）
      await kvCommand(['SET', `passcode:${code}`, tier]);

      // 管理画面用の一覧に追加（新しい順、最大50件）
      const listKey = 'passcode_list';
      let list = [];
      try {
        const existing = await kvCommand(['GET', listKey]);
        list = existing ? JSON.parse(existing) : [];
      } catch (e) {}
      list.unshift({ code, email: customerEmail, stamp });
      list = list.slice(0, 50);
      await kvCommand(['SET', listKey, JSON.stringify(list)]);

      // お客様に自動でメール送信
      await sendPasscodeEmail(customerEmail, code, process.env.APP_DISPLAY_NAME || 'アプリ');

      console.log(`New passcode issued: ${code} for ${customerEmail}`);
    } catch (err) {
      console.error('Error issuing passcode:', err.message);
      // Stripeへは200を返す（再送を防ぐ。エラーはログで確認する）
    }
  }

  res.status(200).json({ received: true });
}
