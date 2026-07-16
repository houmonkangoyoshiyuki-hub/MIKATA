// api/ai_proxy.js
// 無料お試しユーザー向けのAI呼び出し窓口。
// ・自前のAPIキー（本契約ユーザー）は経由しない（フロント側で直接Anthropicを呼ぶ）
// ・ここを通るのはお試しユーザーのみ。1日の回数制限をVercel KVで管理する。

const DAILY_LIMIT_FREE = 5; // 無料お試し
const DAILY_LIMIT_BASIC = 15; // プチ課金プラン（500円等）

async function kvCommand(commandArray) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('KV_REST_API_URL / KV_REST_API_TOKEN が未設定です');
  const res = await fetch(`${url}/${commandArray.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data.result;
}

function todayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
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
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  try {
    const { model, max_tokens, system, messages, clientId, premiumCode, tools } = req.body || {};
    if (!clientId) {
      res.status(400).json({ error: { message: 'clientId が必要です' } });
      return;
    }
    if (!messages) {
      res.status(400).json({ error: { message: 'messages が必要です' } });
      return;
    }

    // ── プランの判定：プチ課金コードが有効なら上限を引き上げる ──
    let dailyLimit = DAILY_LIMIT_FREE;
    if (premiumCode) {
      try {
        const tier = await kvCommand(['GET', `passcode:${String(premiumCode).trim().toUpperCase()}`]);
        if (tier === 'basic' || tier === 'valid') dailyLimit = DAILY_LIMIT_BASIC;
      } catch (e) {}
    }

    // ── 利用回数チェック ──
    const usageKey = `usage:${clientId}:${todayKey()}`;
    let currentCount = 0;
    try {
      currentCount = Number(await kvCommand(['GET', usageKey])) || 0;
    } catch (e) {
      // KV未設定・エラー時は制限なしで通す（ただしログに残す）
      console.error('KV read error:', e.message);
    }

    if (currentCount >= dailyLimit) {
      res.status(429).json({
        error: {
          limited: true,
          message: `本日の利用回数（${dailyLimit}回）の上限に達しました。`,
          dailyLimit,
        },
      });
      return;
    }

    // ── Anthropic呼び出し（サーバー側の秘密キーを使用、フロントには一切見えない） ──
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-haiku-4-5-20251001',
        max_tokens: max_tokens || 2000,
        ...(system ? { system } : {}),
        messages,
        ...(tools ? { tools } : {}),
      }),
    });

    const data = await anthropicRes.json();

    if (!anthropicRes.ok) {
      res.status(anthropicRes.status).json({ error: { message: data?.error?.message || 'AI呼び出しに失敗しました' } });
      return;
    }

    // ── 成功した場合のみカウントを1増やす ──
    try {
      await kvCommand(['INCR', usageKey]);
      await kvCommand(['EXPIRE', usageKey, '172800']); // 2日で自動消去
    } catch (e) {
      console.error('KV write error:', e.message);
    }

    const remaining = Math.max(0, dailyLimit - (currentCount + 1));
    res.status(200).json({ ...data, _remaining: remaining, _dailyLimit: dailyLimit });
  } catch (err) {
    res.status(500).json({ error: { message: 'サーバー側エラー: ' + err.message } });
  }
}
