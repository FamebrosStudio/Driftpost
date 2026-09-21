// Grok caption writer (xAI). Key lives only on the server — never ship it to the browser.
const CHAT_URL = 'https://api.x.ai/v1/chat/completions';

const SYSTEM = `You write social-media copy for a digital agency posting for local brands (salons, jewellers, clinics, resorts).
Always reply with ONE valid JSON object, no markdown, no commentary:
{"youtube":{"title":"<=100 chars","description":"2-3 sentences + call to action","tags":["up to 8 lowercase tags, no #"]},"instagram":{"caption":"<=125 chars hook + emoji + call to action","hashtags":["up to 10, no #"]},"facebook":{"message":"1-2 friendly sentences + call to action"},"x":{"text":"<=280 chars, punchy, no emoji spam"}}
Rules: plain language, no hype words like "ultimate" or "game-changer", business-safe, no invented addresses, prices, or claims. Hashtags lowercase,no spaces.`;

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI returned an unreadable answer');
  return JSON.parse(raw.slice(start, end + 1));
}

function clean(value, max) {
  return String(value || '').trim().slice(0, max);
}

export async function generateCaptions(summary) {
  if (!process.env.XAI_API_KEY) throw new Error('AI is not configured yet (XAI_API_KEY missing)');
  const brief = String(summary || '').trim().slice(0, 500);
  if (brief.length < 3) throw new Error('Write a short summary first (a few words about the post)');
  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.XAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.XAI_MODEL || 'grok-4',
      temperature: 0.8,
      max_tokens: 900,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Post summary: ${brief}` },
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || data.error || `xAI error ${res.status}`;
    if (res.status === 401) throw new Error('AI key rejected. Check XAI_API_KEY.');
    if (res.status === 402 || /credit|balance|payment|billing/i.test(msg)) {
      throw new Error('AI out of credits. Top up the xAI account, then retry.');
    }
    throw new Error(`AI failed: ${msg}`);
  }
  const text = data.choices?.[0]?.message?.content || '';
  const parsed = extractJson(text);
  const tags = (arr) => (Array.isArray(arr) ? arr : []).map((t) => String(t || '').replace(/^#+/, '').trim()).filter(Boolean).slice(0, 10);
  return {
    youtube: {
      title: clean(parsed.youtube?.title, 100),
      description: clean(parsed.youtube?.description, 2000),
      tags: tags(parsed.youtube?.tags).slice(0, 8),
    },
    instagram: {
      caption: clean(parsed.instagram?.caption, 2200),
      hashtags: tags(parsed.instagram?.hashtags),
    },
    facebook: { message: clean(parsed.facebook?.message, 2000) },
    x: { text: clean(parsed.x?.text, 280) },
  };
}
