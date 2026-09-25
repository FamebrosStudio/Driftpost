import React from 'react';

const TONES = ['auto', 'professional', 'luxury', 'funny', 'emotional', 'creative', 'minimal'];
const EMOJIS = [
  { id: 'low', label: 'Few' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'Lots' },
  { id: 'max', label: 'Max' },
];
const LENGTHS = [
  { id: 'short', label: 'Short' },
  { id: 'medium', label: 'Medium' },
  { id: 'detailed', label: 'Detailed' },
];

// Tone / emoji / length controls inside the prompt box.
export default function AISettings({ tone, setTone, emoji, setEmoji, length, setLength }) {
  return (
    <div className="s2-settings">
      <div className="s2-setting">
        <label htmlFor="s2-tone">Tone</label>
        <select id="s2-tone" value={tone} onChange={(e) => setTone(e.target.value)}>
          {TONES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
        </select>
      </div>
      <div className="s2-setting">
        <label htmlFor="s2-emoji">Emoji</label>
        <select id="s2-emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)}>
          {EMOJIS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      <div className="s2-setting">
        <label htmlFor="s2-length">Length</label>
        <select id="s2-length" value={length} onChange={(e) => setLength(e.target.value)}>
          {LENGTHS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
    </div>
  );
}
