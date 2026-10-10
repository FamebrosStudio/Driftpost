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
export default function AISettings({ tone, setTone, emoji, setEmoji, length, setLength, analysis, setAnalysis }) {
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
      <div className="s2-setting">
        <label htmlFor="s2-analysis">Media analyzer</label>
        <select id="s2-analysis" value={analysis} onChange={(e) => setAnalysis(e.target.value)}>
          <option value="fast">Fast captions</option>
          <option value="analyze">Analyze photo + video</option>
        </select>
        {analysis === 'analyze' && <small className="s2-analysis-note">Reads up to 4 photos, or 1 photo plus 6 sampled video frames and speech. This can take longer.</small>}
        {analysis === 'fast' && <small className="s2-analysis-note">Fast mode uses your prompt without scanning attached media.</small>}
      </div>
    </div>
  );
}
