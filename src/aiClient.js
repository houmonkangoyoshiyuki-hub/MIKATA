import { ANTHROPIC_API_KEY } from './config.js';

// ── プランB：病院が発行したAPIキーを使う場合、設定画面から保存されたキーを優先的に使用 ──
export const CUSTOM_KEY_STORAGE = 'custom_api_key';
export function getApiKey() {
  try {
    const custom = localStorage.getItem(CUSTOM_KEY_STORAGE);
    if (custom && custom.trim()) return custom.trim();
  } catch (e) {}
  return ANTHROPIC_API_KEY;
}

// ── 無料お試しユーザーの識別用ID（端末ごとにランダム生成、変更不可） ──
export function getClientId() {
  try {
    let id = localStorage.getItem('client_id');
    if (!id) {
      id = 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('client_id', id);
    }
    return id;
  } catch (e) {
    return 'c_unknown';
  }
}

// AIProxyLimitError: 上限到達時に投げる専用エラー
export class AIProxyLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AIProxyLimitError';
    this.isLimitError = true;
  }
}

// ── AI利用上限到達時のグローバルモーダル（Reactの現在の画面に関係なく必ず表示できるよう、素のDOM操作で実装） ──
export function showGlobalUpgradeModal(message) {
  if (document.getElementById('__ai_limit_modal')) return; // 既に表示中なら二重表示しない
  const overlay = document.createElement('div');
  overlay.id = '__ai_limit_modal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:sans-serif;';
  overlay.innerHTML = `
    <div style="width:100%;max-width:380px;max-height:90vh;overflow-x:hidden;overflow-y:auto;border-radius:16px;background:#fff;box-shadow:0 20px 50px rgba(0,0,0,0.3);">
      <div style="padding:22px 20px;text-align:center;background:linear-gradient(120deg,#E8A87C,#D89268);color:#fff;">
        <div style="font-size:32px;">✨</div>
        <div style="font-size:16px;font-weight:700;margin-top:8px;">お試しいただき、ありがとうございます</div>
        <div style="font-size:12px;margin-top:4px;opacity:0.9;">${(message || '本日の無料お試し回数の上限に達しました。').replace(/</g, '&lt;')}</div>
      </div>
      <div style="padding:20px;">
        <div style="border-radius:12px;padding:14px;background:#F2F1EC;margin-bottom:12px;">
          <div style="font-size:13px;font-weight:700;color:#3D8C7A;margin-bottom:4px;">継続してご利用いただくには</div>
          <div style="font-size:12px;line-height:1.6;color:#5A6B6E;">月額プランへのお申し込みで、翌日以降も回数制限なくご利用いただけます。</div>
        </div>
        <div style="border-radius:12px;padding:14px;background:#FBF0E3;margin-bottom:12px;">
          <div style="font-size:13px;font-weight:700;color:#C97B35;margin-bottom:4px;">💡ちょっとしたヒント</div>
          <div style="font-size:12px;line-height:1.6;color:#8A5B25;">ご家族・お友達にClaude（Anthropic社のAI）を契約されている方がいれば、そのAPIキーをお借りして設定することでもご利用いただけます。</div>
        </div>
        <div style="border-radius:12px;padding:14px;background:#E8F0F5;margin-bottom:16px;">
          <div style="font-size:13px;font-weight:700;color:#3A6B96;margin-bottom:4px;">本契約について</div>
          <div style="font-size:12px;line-height:1.6;color:#3A6B96;">本契約となると、お客様ご自身でAIサービス（Anthropic社）とご契約いただき、そのAPIキーを設定していただく形になります。設定後は、ほぼ無制限でご利用いただけます（利用料はお客様とAnthropic社の直接契約分のみ）。</div>
        </div>
        <a href="#mikata-stripe-link-here" target="_blank" rel="noopener" id="__ai_limit_pay" style="display:block;text-align:center;padding:13px;border-radius:12px;background:#E8A87C;color:#fff;font-weight:700;font-size:14px;text-decoration:none;margin-bottom:10px;">💳 お申し込み（決済ページへ）</a>
        <a href="https://line.me/R/ti/p/@tig9045i" target="_blank" rel="noopener" id="__ai_limit_line" style="display:block;text-align:center;padding:13px;border-radius:12px;background:#06C755;color:#fff;font-weight:700;font-size:14px;text-decoration:none;margin-bottom:10px;">💬 まずは公式LINEで相談する</a>
        <button id="__ai_limit_close" style="display:block;width:100%;text-align:center;padding:8px;background:none;border:none;font-size:12px;color:#8A8F84;">閉じる（また明日お試しください）</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#__ai_limit_close').addEventListener('click', close);
}

// ── AI呼び出しの共通窓口 ──
// 本契約（自分のAPIキー設定済み）：直接Anthropicへ、無制限
// お試しユーザー（キー未設定）：サーバー経由のプロキシへ、1日の回数制限あり
export async function callAI({ system, messages, max_tokens = 2000, model = 'claude-haiku-4-5-20251001', tools = null }) {
  const customKey = (() => {
    try { return localStorage.getItem(CUSTOM_KEY_STORAGE); } catch (e) { return null; }
  })();
  const unlockStillValid = (() => {
    try { return Number(localStorage.getItem('api_key_unlocked_until') || 0) > Date.now(); } catch (e) { return false; }
  })();

  if (customKey && customKey.trim() && unlockStillValid) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': customKey.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, max_tokens, ...(system ? { system } : {}), messages, ...(tools ? { tools } : {}) }),
    });
    return response;
  }

  const response = await fetch('/api/ai_proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens, system, messages, tools, clientId: getClientId(), premiumCode: (() => { try { return localStorage.getItem('premium_tier_code') || ''; } catch (e) { return ''; } })() }),
  });

  if (response.status === 429) {
    const limitData = await response.json().catch(() => ({}));
    const msg = limitData.error?.message || '本日の無料お試し回数の上限に達しました。';
    try { window.dispatchEvent(new CustomEvent('ai-limit-reached', { detail: { message: msg } })); } catch (e) {}
    throw new AIProxyLimitError(msg);
  }

  return response;
}
