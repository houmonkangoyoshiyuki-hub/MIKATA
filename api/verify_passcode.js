// api/verify_passcode.js
// アプリの「APIキー設定」欄で入力されたパスコードを、KVに保存された有効なコードと照合する。

async function kvCommand(commandArray) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const res = await fetch(`${url}/${commandArray.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data.result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ valid: false, message: 'Method not allowed' });
    return;
  }

  try {
    const { passcode } = req.body || {};
    if (!passcode || typeof passcode !== 'string') {
      res.status(400).json({ valid: false });
      return;
    }
    const normalized = passcode.trim().toUpperCase();
    const result = await kvCommand(['GET', `passcode:${normalized}`]);
    // result は 'valid'（本契約=無制限プラン）または 'basic'（プチ課金=1日15回プラン）
    res.status(200).json({ valid: result === 'valid' || result === 'basic', tier: result || null });
  } catch (err) {
    res.status(500).json({ valid: false, message: err.message });
  }
}
