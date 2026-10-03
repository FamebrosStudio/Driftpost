import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, apiRequestUrl } from '../lib.js';
import { mixMusicIntoVideo, mp4RecordingType } from './mixVideoAudio.js';

function artistNames(track) {
  const names = track.mainArtists || track.artists || [];
  return names.map((artist) => typeof artist === 'string' ? artist : artist?.name).filter(Boolean).join(', ');
}

export default function EpidemicCatalog({ token, files, selectedIndex, onSelectVideo, onApply, focusToken = 0 }) {
  const [term, setTerm] = useState('upbeat');
  const [tracks, setTracks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [addingId, setAddingId] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [previewTrack, setPreviewTrack] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const audioRef = useRef(null);
  const hlsRef = useRef(null);
  const detailsRef = useRef(null);
  const videoFiles = useMemo(() => (files || []).map((file, index) => ({ file, index }))
    .filter(({ file }) => String(file.type || file.raw?.type || '').startsWith('video/')), [files]);
  const currentVideo = videoFiles.find(({ index }) => index === selectedIndex) || videoFiles[0] || null;
  const canAdd = !!currentVideo && !!token;

  const stopPreview = () => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  };
  useEffect(() => () => stopPreview(), []);
  useEffect(() => {
    if (!focusToken || !detailsRef.current) return;
    detailsRef.current.open = true;
    window.requestAnimationFrame(() => detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [focusToken]);

  const search = async (event) => {
    event.preventDefault();
    if (!term.trim() || busy) return;
    setBusy(true); setError(''); setSearched(false);
    try {
      const result = await api(`/api/music/search?term=${encodeURIComponent(term.trim())}&limit=20`, token);
      setTracks(result.tracks || []);
      setSearched(true);
    } catch (cause) {
      setTracks([]); setError(cause.message || 'Could not search Epidemic Sound.');
    } finally { setBusy(false); }
  };

  const preview = async (track) => {
    if (previewBusy) return;
    if (previewTrack?.id === track.id && audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause(); return;
    }
    stopPreview(); setPreviewPlaying(false); setError(''); setPreviewBusy(true); setPreviewTrack(track);
    try {
      const result = await api(`/api/music/tracks/${encodeURIComponent(track.id)}/preview`, token);
      const url = apiRequestUrl(result.url);
      const audio = audioRef.current;
      if (!audio) throw new Error('The preview player is not ready.');
      const { default: Hls } = await import('hls.js');
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, backBufferLength: 30, maxBufferLength: 30 });
        hlsRef.current = hls;
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) { stopPreview(); setError('Could not play this preview. Try another track or retry.'); setPreviewBusy(false); }
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => audio.play().catch(() => setError('Press Play in the audio controls to listen.')));
        hls.loadSource(url); hls.attachMedia(audio);
      } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
        audio.src = url;
        await audio.play();
      } else throw new Error('HLS music preview is not supported by this browser. Try the latest Chrome, Edge or Safari.');
    } catch (cause) {
      stopPreview(); setError(cause.message || 'Could not play this track preview.');
    } finally { setPreviewBusy(false); }
  };

  const addTrack = async (track) => {
    if (!canAdd || !track?.id || addingId) return;
    stopPreview(); setPreviewPlaying(false); setPreviewTrack(null); setAddingId(track.id); setProgress(0); setError('');
    const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
    let audioContext;
    try {
      if (!mp4RecordingType()) throw new Error('This browser cannot export a compatible MP4 with mixed music. Try the latest Chrome or Edge on desktop.');
      if (!AudioContextImpl) throw new Error('This browser cannot mix audio into video.');
      audioContext = new AudioContextImpl();
      await audioContext.resume();
      const response = await fetch(apiRequestUrl(`/api/music/tracks/${encodeURIComponent(track.id)}/audio`), { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Could not download this licensed track.');
      }
      const audio = await response.blob();
      const source = currentVideo.file.raw || currentVideo.file;
      const mixed = await mixMusicIntoVideo(source, audio, { audioContext, onProgress: setProgress });
      await onApply(currentVideo.index, mixed, track);
    } catch (cause) { setError(cause.message || 'Could not add this music track.'); }
    finally {
      if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
      setAddingId('');
    }
  };

  return <details className="s2-epidemic" ref={detailsRef}>
    <summary>Add licensed music</summary>
    <p>Preview a track, then mix it into one video. Mixing and editing happen in this browser; the original file stays unchanged unless you apply the finished version.</p>
    {!!videoFiles.length && <label className="s2-music-video">Video to soundtrack
      <select value={currentVideo?.index ?? ''} onChange={(event) => onSelectVideo(Number(event.target.value))} disabled={!!addingId}>
        {videoFiles.map(({ file, index }) => <option key={`${file.name}-${index}`} value={index}>{file.name || `Video ${index + 1}`}</option>)}
      </select>
    </label>}
    <form onSubmit={search}>
      <input aria-label="Search Epidemic Sound" value={term} onChange={(event) => setTerm(event.target.value)} maxLength={160} placeholder="Search music, artist, mood or genre" />
      <button type="submit" disabled={busy || !!addingId || previewBusy || !term.trim()}>{busy ? 'Searching…' : 'Search tracks'}</button>
    </form>
    {!canAdd && <p className="s2-music-status">Add a video in Stage 2 to mix in a soundtrack. Photos cannot have music mixed into them.</p>}
    {previewTrack && <div className="s2-music-player" aria-live="polite"><span>Previewing: <b>{previewTrack.title || previewTrack.name}</b></span><audio ref={audioRef} controls preload="none" onPlay={() => { setPreviewBusy(false); setPreviewPlaying(true); }} onPause={() => setPreviewPlaying(false)} onEnded={() => { setPreviewTrack(null); setPreviewPlaying(false); }} /></div>}
    {addingId && <div className="s2-music-progress" role="status"><span>Mixing music into your video… {progress}% — keep this tab open</span><i><b style={{ width: `${progress}%` }} /></i></div>}
    {error && <p className="s2-music-error" role="alert">{error}</p>}
    {searched && !tracks.length && <p className="s2-music-status">No tracks found for that search.</p>}
    {!!tracks.length && <ul>{tracks.map((track) => <li key={track.id}>
      <span><b>{track.title || track.name || 'Untitled track'}</b><small>{artistNames(track) || 'Epidemic Sound'}{track.bpm ? ` · ${track.bpm} BPM` : ''}{track.length ? ` · ${Math.round(track.length / 60)}:${String(track.length % 60).padStart(2, '0')}` : ''}</small></span>
      <div className="s2-music-actions">
        <button type="button" className="s2-music-preview" disabled={previewBusy || !!addingId} onClick={() => preview(track)}>{previewTrack?.id === track.id && previewBusy ? 'Loading…' : previewTrack?.id === track.id && previewPlaying ? 'Pause' : 'Preview'}</button>
        {track.isPreviewOnly
          ? <em>Preview only</em>
          : <button type="button" disabled={!canAdd || !!addingId || previewBusy} onClick={() => addTrack(track)}>{addingId === track.id ? 'Adding…' : 'Add to video'}</button>}
      </div>
    </li>)}</ul>}
  </details>;
}
