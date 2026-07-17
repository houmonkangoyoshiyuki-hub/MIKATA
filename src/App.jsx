import React, { useState, useEffect, useRef } from 'react';
import { callAI, AIProxyLimitError } from './aiClient.js';

// ── 保存キー ──
const K_PROFILE = 'mikata_profile';
const K_AVATAR = 'mikata_avatar';
const K_ONBOARDED = 'mikata_onboarded';
const K_CHAT_HISTORY = 'mikata_chat_history';
const K_DIARY = 'mikata_diary';
const K_MODE = 'mikata_mode'; // 'talk' | 'listen'

// ── 危険ワード（自傷・希死念慮） ──
const CRISIS_WORDS = ['死にたい', '消えたい', '自殺', '自傷', 'リストカット', '死にたくなる', '生きるのがつらい', '死んだ方がまし'];
// ── 性的・ハラスメント系ワード（簡易検知） ──
const SEXUAL_WORDS = ['セックス', 'エッチ', 'AV', '裸', 'エロ'];
// ── 犯罪・違法系ワード（簡易検知） ──
const CRIME_WORDS = ['殺す', '殺したい', '爆破', '違法薬物', '覚醒剤'];

function detectCrisis(text) {
  return CRISIS_WORDS.some((w) => text.includes(w));
}
function detectSexual(text) {
  return SEXUAL_WORDS.some((w) => text.includes(w));
}
function detectCrime(text) {
  return CRIME_WORDS.some((w) => text.includes(w));
}

const AVATAR_ICONS = ['🧑', '👩', '👨', '🧑‍🦱', '👩‍🦱', '👨‍🦱', '🧑‍🦰', '👩‍🦰'];
const RELATIONSHIPS = ['友達', '先輩', '後輩', 'お兄さん', 'お姉さん'];
const TONES = ['優しい', 'フレンドリー', 'クール', '明るい'];
const AGE_FEELS = ['年上', '同い年', '年下'];
const GENDERS = ['男性', '女性', 'どちらでもない'];

function buildSystemPrompt(profile, avatar, mode, userIsMinor) {
  const base = `あなたは${profile.name || 'あなた'}さんの${avatar.relationship}で、${avatar.ageFeel}の${avatar.gender}です。
口調は${avatar.tone}な感じで話してください。ユーザーの名前は「${profile.name || 'あなた'}」です。基本的にこの名前で呼んでください。

ユーザーのプロフィール（分かっている範囲、無理に聞き出そうとしないこと）：
- 年齢：${profile.age || '未回答'}
- 家族構成：${profile.family || '未回答'}
- 兄弟姉妹：${profile.siblings || '未回答'}
- 体の不調：${profile.health || '未回答'}
- 服薬情報：${profile.medication || '未回答'}
- 気になっていること：${profile.concern || '未回答'}

基本ルール：
1. 共感・傾聴を最優先にする
2. 医療アドバイス・診断は絶対に行わない
3. 返答は150文字前後、短く自然な会話文にする
4. プロフィール情報を、不自然にならない範囲で会話に織り交ぜる
5. カウンセリングとは絶対に名乗らない
6. 自分がAIであることは明言せず、キャラクターとして一貫して話し続ける
7. 「愛してる」「君がいないとダメ」「離れられない」等、恋愛的・過度に依存的な愛情表現は絶対に使わないこと。あくまで${avatar.relationship}としての温かさ・親しみに留めること
8. 恋人・パートナーのような振る舞いは一切しないこと${userIsMinor ? '\n9. ユーザーは未成年の可能性があります。親密な言葉遣い・スキンシップを連想させる表現は一切避け、より一段と丁寧で保護的な距離感を保ってください。' : ''}`;

  if (mode === 'listen') {
    return base + `\n\n現在は「親身に相談モード」（傾聴モード）です。
- 解決策・アドバイスは求められるまで言わない
- 相手の言葉を繰り返して共感を示す
- 感情を深掘りする質問をする（例:「それはどんな気持ちだった？」）
- 1回の返答で質問は1つだけ
- ゆっくり・丁寧なトーンで話す`;
  }
  return base + `\n\n現在は「話すモード」です。普段の会話として、自然に、時には軽い雑談も交えながら話してください。`;
}

function SafetyNotice() {
  return (
    <div className="mx-4 my-2 rounded-2xl p-4" style={{ background: '#FBEAEA', border: '1px solid #E8B8B8' }}>
      <div className="text-sm font-bold mb-1.5" style={{ color: '#A0453F' }}>一人で抱えないでください</div>
      <div className="text-xs leading-relaxed" style={{ color: '#7A3530' }}>
        📞 いのちの電話：0570-783-556（毎日16時〜21時、毎月10日は8時〜翌8時）<br />
        💬 よりそいホットライン：0120-279-338（24時間対応）
      </div>
    </div>
  );
}

// ── オンボーディング：APIキー設定 ──
function OnboardStep1({ onNext }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6" style={{ background: '#F5F0E8' }}>
      <div className="text-5xl mb-4">🌿</div>
      <div className="text-2xl font-bold mb-2" style={{ color: '#3D3D3D' }}>ずっとMIKATA</div>
      <div className="text-sm text-center mb-5 leading-relaxed" style={{ color: '#6B6B6B' }}>
        毎日話せる、あなたの味方。<br />チャットと交換日記で、自分と向き合えます。
      </div>
      <div className="flex flex-wrap justify-center gap-2 mb-8 max-w-xs">
        {['💬 いつでも話せるAI', '📖 交換日記で振り返る', '🔒 データは端末内のみ', '🙅 カウンセリングではない'].map((tag) => (
          <span key={tag} className="text-xs font-bold px-3 py-1.5 rounded-full" style={{ background: '#fff', color: '#7BB8A4', border: '1px solid #DCE9E3' }}>{tag}</span>
        ))}
      </div>
      <button onClick={onNext} className="w-full max-w-xs py-4 rounded-2xl text-base font-bold" style={{ background: '#7BB8A4', color: '#fff' }}>
        はじめる
      </button>
      <div className="text-xs text-center mt-6 leading-relaxed max-w-xs" style={{ color: '#8A8A8A' }}>
        ずっとMIKATAは医療行為・カウンセリングではありません。会話・日記データはお使いの端末のみに保存されます。
      </div>
    </div>
  );
}

// ── オンボーディング：プロフィール収集（会話形式） ──
function OnboardStep2({ onComplete }) {
  const QUESTIONS = [
    { key: 'name', q: 'はじめまして。よかったら、呼んでほしい名前を教えてください（ニックネームでもOKです）', required: true },
    { key: 'age', q: `よろしくお願いします！差し支えなければ、年齢を教えてもらえますか？`, required: false },
    { key: 'family', q: '今はどんな暮らしをされていますか？（一人暮らし、家族と同居、など）', required: false },
    { key: 'siblings', q: 'ご兄弟はいらっしゃいますか？', required: false },
    { key: 'health', q: '最近、体調で気になっていることはありますか？なければスキップで大丈夫です', required: false },
    { key: 'concern', q: '最近、気になっていること・考えていることがあれば、少しだけ教えてください', required: false },
  ];
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [input, setInput] = useState('');

  const submit = (skip) => {
    const val = skip ? '' : input.trim();
    const updated = { ...answers, [QUESTIONS[step].key]: val };
    setAnswers(updated);
    setInput('');
    if (step + 1 < QUESTIONS.length) {
      setStep(step + 1);
    } else {
      onComplete(updated);
    }
  };

  const q = QUESTIONS[step];

  return (
    <div className="flex flex-col min-h-screen px-5 py-8" style={{ background: '#F5F0E8' }}>
      <div className="text-xs mb-6" style={{ color: '#8A8A8A' }}>{step + 1} / {QUESTIONS.length}</div>
      <div className="flex-1">
        <div className="flex items-start gap-2.5 mb-6">
          <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#7BB8A4', fontSize: 18 }}>🌿</div>
          <div className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed" style={{ background: '#fff', color: '#3D3D3D', maxWidth: '85%' }}>
            {q.q}
          </div>
        </div>
      </div>
      <div className="flex gap-2 items-end">
        <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="ここに入力"
          className="flex-1 rounded-2xl px-4 py-3 text-sm outline-none resize-none" style={{ background: '#fff', color: '#3D3D3D', border: '1px solid #E5DFD3' }}
          rows={2} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(false); } }} />
        <button onClick={() => submit(false)} className="px-4 py-3 rounded-2xl text-sm font-bold flex-shrink-0" style={{ background: '#7BB8A4', color: '#fff' }}>送る</button>
      </div>
      {!q.required && <button onClick={() => submit(true)} className="text-xs mt-3 self-center" style={{ color: '#8A8A8A' }}>スキップする</button>}
    </div>
  );
}

// ── オンボーディング：アバター設定 ──
function OnboardStep3({ onComplete }) {
  const [gender, setGender] = useState('女性');
  const [ageFeel, setAgeFeel] = useState('年上');
  const [tone, setTone] = useState('優しい');
  const [relationship, setRelationship] = useState('先輩');
  const [icon, setIcon] = useState(AVATAR_ICONS[0]);
  const [photoData, setPhotoData] = useState('');
  const fileInputRef = useRef(null);

  const handlePhotoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { alert('写真のサイズが大きすぎます（3MB以下にしてください）'); return; }
    const reader = new FileReader();
    reader.onload = () => setPhotoData(reader.result);
    reader.readAsDataURL(file);
  };

  const Picker = ({ label, options, value, setValue }) => (
    <div className="mb-5">
      <div className="text-xs font-bold mb-2" style={{ color: '#6B6B6B' }}>{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o} onClick={() => setValue(o)} className="text-sm font-bold px-3.5 py-2 rounded-full"
            style={value === o ? { background: '#7BB8A4', color: '#fff' } : { background: '#fff', color: '#6B6B6B', border: '1px solid #E5DFD3' }}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen px-5 py-8" style={{ background: '#F5F0E8' }}>
      <div className="text-lg font-bold mb-1" style={{ color: '#3D3D3D' }}>MIKATAのすがたを決めましょう</div>
      <div className="text-xs mb-6" style={{ color: '#8A8A8A' }}>あとから設定でいつでも変更できます</div>

      <div className="mb-5">
        <div className="text-xs font-bold mb-2" style={{ color: '#6B6B6B' }}>写真を選ぶ（任意）</div>
        <div className="flex items-center gap-3">
          <button onClick={() => fileInputRef.current?.click()} className="w-16 h-16 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0"
            style={{ background: '#fff', border: photoData ? '2px solid #5F9A85' : '1px dashed #C9C2B3' }}>
            {photoData ? <img src={photoData} alt="" className="w-full h-full object-cover" /> : <span style={{ fontSize: 22, color: '#C9C2B3' }}>＋</span>}
          </button>
          <div className="text-xs leading-relaxed" style={{ color: '#8A8A8A' }}>
            お気に入りの写真・イラストを選べます。写真はこの端末だけに保存され、外部には送信されません。
            {photoData && <button onClick={() => setPhotoData('')} className="block mt-1 font-bold" style={{ color: '#A0453F' }}>写真を外す</button>}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
        </div>
      </div>

      <div className="mb-5">
        <div className="text-xs font-bold mb-2" style={{ color: '#6B6B6B' }}>{photoData ? 'または、アイコンを選ぶ' : 'アイコン'}</div>
        <div className="flex flex-wrap gap-2">
          {AVATAR_ICONS.map((ic) => (
            <button key={ic} onClick={() => { setIcon(ic); setPhotoData(''); }} className="w-12 h-12 rounded-full flex items-center justify-center text-xl"
              style={!photoData && icon === ic ? { background: '#7BB8A4', border: '2px solid #5F9A85' } : { background: '#fff', border: '1px solid #E5DFD3' }}>
              {ic}
            </button>
          ))}
        </div>
      </div>
      <Picker label="性別" options={GENDERS} value={gender} setValue={setGender} />
      <Picker label="年齢の感じ" options={AGE_FEELS} value={ageFeel} setValue={setAgeFeel} />
      <Picker label="口調" options={TONES} value={tone} setValue={setTone} />
      <Picker label="関係性" options={RELATIONSHIPS} value={relationship} setValue={setRelationship} />

      <button onClick={() => onComplete({ gender, ageFeel, tone, relationship, icon, photo: photoData })}
        className="w-full py-4 rounded-2xl text-base font-bold mt-4" style={{ background: '#7BB8A4', color: '#fff' }}>
        この内容ではじめる
      </button>
    </div>
  );
}

// ── チャット画面 ──
// ── アバター表示（写真があれば写真、なければアイコン） ──
function AvatarBadge({ avatar, size = 28 }) {
  return (
    <div className="rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ width: size, height: size, background: '#fff', fontSize: size * 0.55 }}>
      {avatar?.photo ? <img src={avatar.photo} alt="" className="w-full h-full object-cover" /> : (avatar?.icon || '🌿')}
    </div>
  );
}

function ChatScreen({ profile, avatar }) {
  const [mode, setMode] = useState(() => { try { return localStorage.getItem(K_MODE) || 'talk'; } catch (e) { return 'talk'; } });
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem(K_CHAT_HISTORY) || '[]'); } catch (e) { return []; }
  });
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showCrisis, setShowCrisis] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [history, isLoading]);
  useEffect(() => { try { localStorage.setItem(K_MODE, mode); } catch (e) {} }, [mode]);

  const send = async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    const userIsMinor = /未成年|中学生|高校生|小学生|歳です.*1[0-7]/.test(text) || (profile.age && parseInt(profile.age, 10) < 18);

    if (detectCrime(text)) {
      const updated = [...history, { role: 'user', text }, { role: 'assistant', text: 'それは私には答えられないよ。別の話しよ？' }];
      setHistory(updated);
      try { localStorage.setItem(K_CHAT_HISTORY, JSON.stringify(updated.slice(-40))); } catch (e) {}
      return;
    }
    if (detectSexual(text)) {
      const updated = [...history, { role: 'user', text }, { role: 'assistant', text: 'それはちょっと答えられないな〜、他の話しよ？' }];
      setHistory(updated);
      try { localStorage.setItem(K_CHAT_HISTORY, JSON.stringify(updated.slice(-40))); } catch (e) {}
      return;
    }

    const newHistory = [...history, { role: 'user', text }];
    setHistory(newHistory);
    setIsLoading(true);
    if (detectCrisis(text)) setShowCrisis(true);

    try {
      const systemPrompt = buildSystemPrompt(profile, avatar, mode, userIsMinor);
      const messages = newHistory.slice(-20).map((h) => ({ role: h.role, content: h.text }));
      const response = await callAI({ system: systemPrompt, messages, max_tokens: 400, model: 'claude-haiku-4-5-20251001' });
      if (response.status === 429) throw new AIProxyLimitError('本日の無料お試し回数の上限に達しました。');
      if (!response.ok) throw new Error(`APIエラー (${response.status})`);
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      const reply = data.content?.find((b) => b.type === 'text')?.text || '（うまく応答できませんでした）';
      const updated = [...newHistory, { role: 'assistant', text: reply }];
      setHistory(updated);
      try { localStorage.setItem(K_CHAT_HISTORY, JSON.stringify(updated.slice(-40))); } catch (e) {}
    } catch (err) {
      if (!err?.isLimitError) {
        const updated = [...newHistory, { role: 'assistant', text: '（ごめんね、ちょっとうまく繋がらなかったみたい。もう一度送ってみて）' }];
        setHistory(updated);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col fixed inset-0" style={{ bottom: 64, background: '#F5F0E8' }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ background: '#fff', borderBottom: '1px solid #E5DFD3' }}>
        <div className="flex items-center gap-2">
          <AvatarBadge avatar={avatar} size={32} />
          <span className="text-sm font-bold" style={{ color: '#3D3D3D' }}>MIKATA</span>
        </div>
        <div className="flex rounded-full p-0.5" style={{ background: '#F0EBE0' }}>
          <button onClick={() => setMode('talk')} className="text-xs font-bold px-3 py-1.5 rounded-full"
            style={mode === 'talk' ? { background: '#7BB8A4', color: '#fff' } : { color: '#8A8A8A' }}>💬 話す</button>
          <button onClick={() => setMode('listen')} className="text-xs font-bold px-3 py-1.5 rounded-full"
            style={mode === 'listen' ? { background: '#7BB8A4', color: '#fff' } : { color: '#8A8A8A' }}>🌿 親身に相談</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {history.length === 0 && (
          <div className="text-center text-xs mt-10" style={{ color: '#B0AA9C' }}>メッセージを送って、話しかけてみてください</div>
        )}
        {history.map((h, i) => (
          <div key={i} className={`flex mb-3 ${h.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {h.role === 'assistant' && (
              <AvatarBadge avatar={avatar} size={28} />
            )}
            <div className="rounded-2xl px-4 py-2.5 text-sm leading-relaxed" style={{
              maxWidth: '75%',
              background: h.role === 'user' ? '#7BB8A4' : '#fff',
              color: h.role === 'user' ? '#fff' : '#3D3D3D',
              borderTopRightRadius: h.role === 'user' ? 4 : 16,
              borderTopLeftRadius: h.role === 'assistant' ? 4 : 16,
            }}>
              {h.text}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start mb-3">
            <AvatarBadge avatar={avatar} size={28} />
            <div className="rounded-2xl px-4 py-2.5 text-sm" style={{ background: '#fff', color: '#B0AA9C' }}>…</div>
          </div>
        )}
        {showCrisis && <SafetyNotice />}
        <div ref={scrollRef} />
      </div>

      <div className="flex gap-2 items-end px-4 py-3" style={{ background: '#fff', borderTop: '1px solid #E5DFD3' }}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="メッセージを送る"
          className="flex-1 rounded-2xl px-4 py-2.5 text-sm outline-none resize-none" style={{ background: '#F5F0E8', color: '#3D3D3D', border: 'none' }}
          rows={1} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button onClick={send} disabled={isLoading} className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-50" style={{ background: '#7BB8A4', color: '#fff' }}>➤</button>
      </div>
    </div>
  );
}

// ── 日記画面 ──
function DiaryScreen({ avatar }) {
  const [todayText, setTodayText] = useState('');
  const [entries, setEntries] = useState(() => {
    try { return JSON.parse(localStorage.getItem(K_DIARY) || '[]'); } catch (e) { return []; }
  });
  const [isLoading, setIsLoading] = useState(false);
  const [openId, setOpenId] = useState('');

  const submitDiary = async () => {
    if (!todayText.trim() || isLoading) return;
    setIsLoading(true);
    try {
      const prompt = `ユーザーが以下の日記を書きました。内容をしっかり読んで、交換日記のように温かくコメントしてください。返答は200文字前後。アドバイスより共感を優先してください。「愛してる」等の過度な愛情表現は使わないこと。

日記の内容：
${todayText}`;
      const response = await callAI({ messages: [{ role: 'user', content: prompt }], max_tokens: 400, model: 'claude-haiku-4-5-20251001' });
      if (response.status === 429) throw new AIProxyLimitError('本日の無料お試し回数の上限に達しました。');
      if (!response.ok) throw new Error(`APIエラー (${response.status})`);
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      const comment = data.content?.find((b) => b.type === 'text')?.text || '';
      const now = new Date();
      const entry = { id: Date.now(), date: `${now.getMonth() + 1}/${now.getDate()}`, text: todayText, comment };
      const updated = [entry, ...entries];
      setEntries(updated);
      try { localStorage.setItem(K_DIARY, JSON.stringify(updated.slice(0, 100))); } catch (e) {}
      setTodayText('');
    } catch (err) {
      if (!err?.isLimitError) alert('コメントの取得に失敗しました。もう一度お試しください。');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="px-4 py-4 overflow-y-auto fixed inset-0" style={{ bottom: 64, background: '#F5F0E8' }}>
      <div className="rounded-2xl p-4 mb-4" style={{ background: '#fff' }}>
        <div className="text-xs font-bold mb-2" style={{ color: '#8A8A8A' }}>{new Date().toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })}</div>
        <textarea value={todayText} onChange={(e) => setTodayText(e.target.value)} placeholder="今日あったこと、感じたことを自由に書いてください"
          className="w-full h-28 rounded-xl px-3 py-2.5 text-sm outline-none resize-none" style={{ background: '#F5F0E8', color: '#3D3D3D', border: 'none' }} />
        <button onClick={submitDiary} disabled={isLoading} className="w-full mt-3 py-3 rounded-xl text-sm font-bold disabled:opacity-50" style={{ background: '#E8A87C', color: '#fff' }}>
          {isLoading ? 'MIKATAが読んでいます…' : 'MIKATAに読んでもらう'}
        </button>
      </div>

      {entries.map((e) => (
        <div key={e.id} className="rounded-2xl p-4 mb-3" style={{ background: '#fff' }}>
          <button onClick={() => setOpenId((v) => (v === e.id ? '' : e.id))} className="w-full text-left">
            <div className="text-xs font-bold mb-1" style={{ color: '#8A8A8A' }}>{e.date}</div>
            <div className="text-sm" style={{ color: '#3D3D3D' }}>{openId === e.id ? e.text : e.text.slice(0, 30) + (e.text.length > 30 ? '…' : '')}</div>
          </button>
          {openId === e.id && e.comment && (
            <div className="flex items-start gap-2 mt-3 pt-3" style={{ borderTop: '1px solid #F0EBE0' }}>
              <AvatarBadge avatar={avatar} size={28} />
              <div className="text-sm leading-relaxed" style={{ color: '#3D3D3D' }}>{e.comment}</div>
            </div>
          )}
        </div>
      ))}
      {entries.length === 0 && <div className="text-center text-xs mt-6" style={{ color: '#B0AA9C' }}>まだ日記がありません</div>}
    </div>
  );
}

// ── まとめ画面 ──
function SummaryScreen() {
  const [summary, setSummary] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setIsLoading(true);
    try {
      const chatHistory = (() => { try { return JSON.parse(localStorage.getItem(K_CHAT_HISTORY) || '[]'); } catch (e) { return []; } })();
      const diary = (() => { try { return JSON.parse(localStorage.getItem(K_DIARY) || '[]'); } catch (e) { return []; } })();
      if (chatHistory.length === 0 && diary.length === 0) {
        setSummary('まだ記録がありません。チャットや日記を使ってみてください。');
        setIsLoading(false);
        return;
      }
      const chatText = chatHistory.slice(-30).map((h) => `${h.role === 'user' ? '本人' : 'MIKATA'}: ${h.text}`).join('\n');
      const diaryText = diary.slice(0, 10).map((d) => `${d.date}: ${d.text}`).join('\n');
      const prompt = `以下の会話・日記の記録を要約してください。気持ちの変化・よく出てくるテーマ・最近の状態を簡潔にまとめてください。箇条書き＋短い文章で出力してください。専門用語は使わず、本人や周囲が読んでわかる言葉で。

【会話記録】
${chatText || '(なし)'}

【日記記録】
${diaryText || '(なし)'}`;
      const response = await callAI({ messages: [{ role: 'user', content: prompt }], max_tokens: 800, model: 'claude-haiku-4-5-20251001' });
      if (response.status === 429) throw new AIProxyLimitError('本日の無料お試し回数の上限に達しました。');
      if (!response.ok) throw new Error(`APIエラー (${response.status})`);
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      setSummary(data.content?.find((b) => b.type === 'text')?.text || '');
    } catch (err) {
      if (!err?.isLimitError) setSummary('まとめの作成に失敗しました。もう一度お試しください。');
    } finally {
      setIsLoading(false);
    }
  };

  const copy = () => {
    navigator.clipboard?.writeText(summary).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="px-4 py-4 overflow-y-auto fixed inset-0" style={{ bottom: 64, background: '#F5F0E8' }}>
      <button onClick={generate} disabled={isLoading} className="w-full py-4 rounded-2xl text-sm font-bold disabled:opacity-50 mb-4" style={{ background: '#7BB8A4', color: '#fff' }}>
        {isLoading ? 'まとめています…' : '✨ 気持ちをまとめる'}
      </button>
      {summary && (
        <div className="rounded-2xl p-4" style={{ background: '#fff' }}>
          <div className="text-sm leading-relaxed whitespace-pre-wrap mb-4" style={{ color: '#3D3D3D' }}>{summary}</div>
          <div className="text-xs mb-3 p-3 rounded-xl leading-relaxed" style={{ background: '#F5F0E8', color: '#8A8A8A' }}>
            大切な気持ちの記録です。必要な時に、信頼できる人に見せてください。
          </div>
          <button onClick={copy} className="w-full py-2.5 rounded-xl text-xs font-bold" style={{ background: '#E8A87C', color: '#fff' }}>{copied ? 'コピーしました' : 'コピーする'}</button>
        </div>
      )}
    </div>
  );
}

// ── 設定画面 ──
function SettingsScreen({ profile, setProfile, avatar, setAvatar }) {
  const [customKeyInput, setCustomKeyInput] = useState(() => { try { return localStorage.getItem('custom_api_key') || ''; } catch (e) { return ''; } });
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const saveKey = () => {
    try {
      if (customKeyInput.trim()) localStorage.setItem('custom_api_key', customKeyInput.trim());
      else localStorage.removeItem('custom_api_key');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {}
  };

  const resetAll = () => {
    try { localStorage.clear(); } catch (e) {}
    window.location.reload();
  };

  return (
    <div className="px-4 py-4 overflow-y-auto space-y-4 fixed inset-0" style={{ bottom: 64, background: '#F5F0E8' }}>
      <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: '#fff' }}>
        <AvatarBadge avatar={avatar} size={48} />
        <div className="flex-1">
          <div className="text-sm font-bold mb-1" style={{ color: '#3D3D3D' }}>アバター設定</div>
          <div className="text-xs mb-1" style={{ color: '#8A8A8A' }}>関係性：{avatar.relationship} / 口調：{avatar.tone}</div>
          <div className="text-xs" style={{ color: '#8A8A8A' }}>アバターの変更は今後のアップデートで対応予定です</div>
        </div>
      </div>

      <div className="rounded-2xl p-4" style={{ background: '#fff' }}>
        <div className="text-sm font-bold mb-2" style={{ color: '#3D3D3D' }}>APIキー設定（本契約プランの場合）</div>
        <div className="text-xs mb-2 leading-relaxed" style={{ color: '#8A8A8A' }}>
          ご自身で発行いただいたAPIキーを貼り付けてください。空欄の場合は標準のキー（回数制限あり）が使われます。
        </div>
        <div className="flex gap-2">
          <input type="password" value={customKeyInput} onChange={(e) => setCustomKeyInput(e.target.value)} placeholder="sk-ant-..."
            className="flex-1 rounded-xl px-3 py-2 text-sm outline-none" style={{ background: '#F5F0E8', color: '#3D3D3D', border: 'none' }} />
          <button onClick={saveKey} className="px-4 py-2 rounded-xl text-sm font-bold" style={{ background: '#7BB8A4', color: '#fff' }}>{saved ? '保存済み' : '保存'}</button>
        </div>
      </div>

      <div className="rounded-2xl p-4" style={{ background: '#fff' }}>
        <div className="text-sm font-bold mb-2" style={{ color: '#A0453F' }}>データの削除</div>
        <div className="text-xs mb-2 leading-relaxed" style={{ color: '#8A8A8A' }}>
          会話・日記・プロフィール等、この端末に保存された全データを削除します。この操作は取り消せません。
        </div>
        {!confirmReset ? (
          <button onClick={() => setConfirmReset(true)} className="w-full py-2.5 rounded-xl text-sm font-bold" style={{ background: '#FBEAEA', color: '#A0453F' }}>🗑 全データを削除する</button>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => setConfirmReset(false)} className="flex-1 py-2.5 rounded-xl text-xs font-bold" style={{ background: '#F5F0E8', color: '#8A8A8A' }}>キャンセル</button>
            <button onClick={resetAll} className="flex-1 py-2.5 rounded-xl text-xs font-bold" style={{ background: '#A0453F', color: '#fff' }}>削除する</button>
          </div>
        )}
      </div>

      <div className="rounded-2xl p-4 text-xs leading-relaxed" style={{ background: '#fff', color: '#8A8A8A' }}>
        ずっとMIKATAは医療行為・カウンセリングではありません。危機的な状況の場合は専門機関にご相談ください。会話・日記データはお使いの端末のみに保存されます。Claude APIとの通信はAnthropic社のプライバシーポリシーに準拠します。このアプリを通じて個人情報が開発者に送信されることはありません。
      </div>
    </div>
  );
}

export default function App() {
  const [onboarded, setOnboarded] = useState(() => { try { return localStorage.getItem(K_ONBOARDED) === 'yes'; } catch (e) { return false; } });
  const [onboardStep, setOnboardStep] = useState(0);
  const [profile, setProfile] = useState(() => { try { return JSON.parse(localStorage.getItem(K_PROFILE) || '{}'); } catch (e) { return {}; } });
  const [avatar, setAvatar] = useState(() => { try { return JSON.parse(localStorage.getItem(K_AVATAR) || 'null'); } catch (e) { return null; } });
  const [tab, setTab] = useState('chat');

  useEffect(() => {
    const onLimit = (e) => {
      import('./aiClient.js').then(({ showGlobalUpgradeModal }) => showGlobalUpgradeModal(e.detail?.message));
    };
    window.addEventListener('ai-limit-reached', onLimit);
    return () => window.removeEventListener('ai-limit-reached', onLimit);
  }, []);

  if (!onboarded) {
    if (onboardStep === 0) return <OnboardStep1 onNext={() => setOnboardStep(1)} />;
    if (onboardStep === 1) return <OnboardStep2 onComplete={(p) => { setProfile(p); try { localStorage.setItem(K_PROFILE, JSON.stringify(p)); } catch (e) {} setOnboardStep(2); }} />;
    if (onboardStep === 2) return <OnboardStep3 onComplete={(a) => {
      setAvatar(a);
      try { localStorage.setItem(K_AVATAR, JSON.stringify(a)); localStorage.setItem(K_ONBOARDED, 'yes'); } catch (e) {}
      setOnboarded(true);
    }} />;
  }

  const TABS = [
    { id: 'chat', label: 'チャット', icon: '💬' },
    { id: 'diary', label: '日記', icon: '📖' },
    { id: 'summary', label: 'まとめ', icon: '📋' },
    { id: 'settings', label: '設定', icon: '⚙️' },
  ];

  return (
    <div style={{ fontFamily: "'Noto Sans JP', sans-serif" }}>
      {tab === 'chat' && <ChatScreen profile={profile} avatar={avatar || {}} />}
      {tab === 'diary' && <DiaryScreen avatar={avatar || {}} />}
      {tab === 'summary' && <SummaryScreen />}
      {tab === 'settings' && <SettingsScreen profile={profile} setProfile={setProfile} avatar={avatar || {}} setAvatar={setAvatar} />}

      <div className="fixed bottom-0 left-0 right-0 flex" style={{ height: 64, background: '#fff', borderTop: '1px solid #E5DFD3' }}>
        {TABS.map((tb) => (
          <button key={tb.id} onClick={() => setTab(tb.id)} className="flex-1 flex flex-col items-center justify-center gap-0.5">
            <span style={{ fontSize: 18, opacity: tab === tb.id ? 1 : 0.4 }}>{tb.icon}</span>
            <span className="text-xs font-bold" style={{ color: tab === tb.id ? '#7BB8A4' : '#B0AA9C' }}>{tb.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
