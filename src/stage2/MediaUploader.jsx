import React, { useRef, useState } from 'react';

const MAX_MEDIA_FILES = 20;

// Big minimal dropzone: click to browse, or drag & drop. Images + video.
export default function MediaUploader({ count, onFiles, canUseAi = false }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const [message, setMessage] = useState('');

  const take = (list) => {
    const selected = [...(list || [])].filter((f) => f && /^(image|video)\//.test(f.type));
    const arr = selected.filter((f) => f.size <= 400 * 1024 * 1024);
    setMessage(selected.length !== arr.length ? 'Each file must be 400 MB or smaller.' : '');
    if (arr.length) onFiles(arr);
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => { take(e.target.files); e.target.value = ''; }}
      />
      <button
        type="button"
        className={over ? 's2-drop over' : 's2-drop'}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
      >
        <span className="s2-drop-icon" aria-hidden="true">↑</span>
        <b>Drop photos or videos here, or browse{count ? ` (${count}/${MAX_MEDIA_FILES})` : ''}</b>
        <small>{canUseAi ? 'High-resolution images or videos up to 400 MB. Open any item in Studio Edit to crop, color-grade, add text/shapes, or trim video.' : 'High-resolution images or videos up to 400 MB. Click Studio Edit on any item to crop, filter, add text, or trim.'}</small>
      </button>
      {message && <small role="status" style={{ display: 'block', marginTop: 8, color: '#f87171' }}>{message}</small>}
    </div>
  );
}
