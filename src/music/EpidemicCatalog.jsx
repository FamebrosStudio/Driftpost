import React, { useState } from 'react';
import { api, apiRequestUrl } from '../lib.js';
import { mixMusicIntoVideo, mp4RecordingType } from './mixVideoAudio.js';

function artistNames(track) {
  const names = track.mainArtists || track.artists || [];
  return names.map((artist) => typeof artist === 'string' ? artist : artist?.name).filter(Boolean).join(', ');
}

export default function EpidemicCatalog({ token, files, onApply }) {
  const [term, setTerm] = useState('upbeat');
  const [tracks, setTracks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [addingId, setAddingId] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const canAdd = files?.length === 1 && String(files[0]?.type || files[0]?.raw?.type || '').startsWith('video/');

  const search = async (event) => {
    event.preventDefault();
    if (!term.trim() || busy) return;
    setBusy(true);
    setError('');
    setSearched(false);
    try {
      const result = await api(`/api/music/search?term=${encodeURIComponent(term.trim())}&limit=20`, token);
      setTracks(result.tracks || []);
      setSearched(true);
    } catch (cause) {
      setTracks([]);
      setError(cause.message || 'Could not search Epidemic Sound.');
    } finally {
      setBusy(false);
    }
  };

  const addTrack = async (track) => {
    if (!canAdd || !track?.id || addingId) return;
    setAddingId(track.id);
    setProgress(0);
    setError('');
    const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
    let audioContext;
    try {
      if (!mp4RecordingType()) throw new Error('This browser cannot make a compatible MP4 with music. Try the latest Chrome or Edge on desktop.');
      if (!AudioContextImpl) throw new Error('This browser cannot mix audio into video.');
      audioContext = new AudioContextImpl();
      await audioContext.resume();
      const response = await fetch(apiRequestUrl(`/api/music/tracks/${encodeURIComponent(track.id)}/audio`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Could not download this licensed track.');
      }
      const audio = await response.blob();
      const mixed = await mixMusicIntoVideo(files[0].raw, audio, {
        audioContext,
        onProgress: setProgress,
      });
      await onApply(mixed, track);
    } catch (cause) {
      setError(cause.message || 'Could not add this music track.');
    } finally {
      if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
      setAddingId('');
    }
  };

  return (
    <details className="s3-epidemic">
      <summary>Add licensed music</summary>
      <p>Choose a track and mix it into one video. The video plays through while Driftpost creates the finished MP4.</p>
      <form onSubmit={search}>
        <input aria-label="Search Epidemic Sound" value={term} onChange={(event) => setTerm(event.target.value)} maxLength={160} placeholder="Search music, artist, mood or genre" />
        <button type="submit" disabled={busy || !!addingId || !term.trim()}>{busy ? 'Searching…' : 'Search tracks'}</button>
      </form>
      {!canAdd && <p className="s3-epidemic-status">Select one video in Stage 2 to add a soundtrack. Photos and multi-file carousels can’t have music mixed into them.</p>}
      {addingId && <div className="s3-epidemic-progress" role="status"><span>Mixing music into your video… {progress}%</span><i><b style={{ width: `${progress}%` }} /></i></div>}
      {error && <p className="s3-epidemic-error" role="alert">{error}</p>}
      {searched && !tracks.length && <p className="s3-epidemic-status">Epidemic Sound responded, but found no tracks for that search.</p>}
      {!!tracks.length && <ul>
        {tracks.map((track) => (
          <li key={track.id}>
            <span><b>{track.title || track.name || 'Untitled track'}</b><small>{artistNames(track) || 'Epidemic Sound'}{track.bpm ? ` · ${track.bpm} BPM` : ''}</small></span>
            {track.isPreviewOnly
              ? <em>Preview only</em>
              : <button type="button" disabled={!canAdd || !!addingId} onClick={() => addTrack(track)}>{addingId === track.id ? 'Adding…' : 'Add to video'}</button>}
          </li>
        ))}
      </ul>}
    </details>
  );
}
