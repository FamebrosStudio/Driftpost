import React from 'react';
import AISettings from './AISettings.jsx';
import GenerateButton from './GenerateButton.jsx';

// Section 2: prompt box + quick controls + generate.
export default function PromptBuilder({ brief, setBrief, tone, setTone, emoji, setEmoji, length, setLength, busy, canGenerate, onGenerate }) {
  return (
    <div>
      <label htmlFor="s2-brief" style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
        Tell AI what you want to create
      </label>
      <textarea
        id="s2-brief"
        className="s2-prompt"
        value={brief}
        maxLength={600}
        onChange={(e) => setBrief(e.target.value)}
        placeholder="Example: Create a premium festive post for my jewellery brand…"
      />
      <AISettings tone={tone} setTone={setTone} emoji={emoji} setEmoji={setEmoji} length={length} setLength={setLength} />
      <GenerateButton disabled={!canGenerate || busy} busy={busy} onClick={onGenerate} />
    </div>
  );
}
