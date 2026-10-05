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
        <b>+ Add Media{count ? ` (${count}/${MAX_MEDIA_FILES})` : ''}</b>
        <small>{canUseAi ? 'Images or video, up to 400 MB per file. Choose Analyze photo + video in the prompt settings to include visual and spoken details.' : 'Images or video, up to 400 MB per file.'}</small>
      </button>
      {message && <small role="status" style={{ display: 'block', marginTop: 8, color: '#e28e8e' }}>{message}</small>}
    </div>
  );
}
