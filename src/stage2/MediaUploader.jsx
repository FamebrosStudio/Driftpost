import React, { useRef, useState } from 'react';

// Big minimal dropzone: click to browse, or drag & drop. Images + video.
export default function MediaUploader({ count, onFiles }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);

  const take = (list) => {
    const arr = [...(list || [])].filter((f) => f && /^(image|video)\//.test(f.type));
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
        <b>+ Add Media{count ? ` (${count}/10)` : ''}</b>
        <small>Images or video · click to browse or drop files here</small>
      </button>
    </div>
  );
}
