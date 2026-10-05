import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, apiRequestUrl } from '../lib.js';
import { mixImageIntoVideo, mixMusicIntoVideo, mp4RecordingType } from './mixVideoAudio.js';

function artistNames(track) {
  const names = track.mainArtists || track.artists || [];
  return names.map((artist) => typeof artist === 'string' ? artist : artist?.name).filter(Boolean).join(', ');
}

export default function EpidemicCatalog({ token, files, selectedIndex, onSelectVideo, onApply, summaryLabel = 'Add music' }) {
  const [term, setTerm] = useState('upbeat');
  const [tracks, setTracks] = useState([]);
  const [nextOffset, setNextOffset] = useState(null);
  const [busy, setBusy] = useState(false);
  const [addingId, setAddingId] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [imageDuration, setImageDuration] = useState(15);
  const [previewTrack, setPreviewTrack] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const audioRef = useRef(null);
  const hlsRef = useRef(null);
  const detailsRef = useRef(null);
  const mediaFiles = useMemo(() => (files || []).map((file, index) => ({ file, index }))
    .filter(({ file }) => /^(video|image)\//.test(String(file.type || file.raw?.type || ''))), [files]);
  const currentMedia = mediaFiles.find(({ index }) => index === selectedIndex) || mediaFiles[0] || null;
  const sourceFile = currentMedia?.file?.raw || currentMedia?.file;
  const isImage = String(sourceFile?.type || currentMedia?.file?.type || '').startsWith('image/');
  const canAdd = !!currentMedia && !!token;

  const fetchTracks = async (offset, append) => {
    const result = await api(`/api/music/search?term=${encodeURIComponent(term.trim())}&limit=30&offset=${offset}`, token);
    const page = Array.isArray(result.tracks) ? result.tracks : [];
    setTracks((previous) => {
      if (!append) return page;
      const known = new Set(previous.map((track) => track.id));
      return [...previous, ...page.filter((track) => !known.has(track.id))];
    });
    const nextHref = result.links?.next;
    const nextFromLink = typeof nextHref === 'string' ? Number(nextHref.match(/[?&]offset=(\d+)/)?.[1]) : NaN;
    const pageOffset = Number(result.pagination?.offset ?? offset);
    const pageLimit = Number(result.pagination?.limit ?? 30);
    const candidate = Number.isFinite(nextFromLink) ? nextFromLink : page.length >= pageLimit ? pageOffset + pageLimit : NaN;
    setNextOffset(Number.isFinite(candidate) && candidate > offset && candidate < 500 ? candidate : null);
    return page;
  };

  const stopPreview = () => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  };
  useEffect(() => () => stopPreview(), []);
  const search = async (event) => {
    event.preventDefault();
    if (!term.trim() || busy) return;
    setBusy(true); setError(''); setSearched(false);
    try {
      setNextOffset(null);
      await fetchTracks(0, false);
      setSearched(true);
    } catch (cause) {
      setTracks([]); setNextOffset(null); setError(cause.message || 'Could not search Epidemic Sound.');
    } finally { setBusy(false); }
  };

  const loadMore = async () => {
    if (nextOffset == null || busy || addingId || !term.trim()) return;
    setBusy(true); setError('');
    try { await fetchTracks(nextOffset, true); }
    catch (cause) { setError(cause.message || 'Could not load more music.'); }
    finally { setBusy(false); }
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
        await new Promise((resolve, reject) => {
          let settled = false;
          const timer = setTimeout(() => finish(new Error('Preview is taking too long to load. Try again.')), 20_000);
          const finish = (cause) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            cause ? reject(cause) : resolve();
          };
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal) return;
            const message = data.type === Hls.ErrorTypes.NETWORK_ERROR
              ? 'The music preview stream could not load. Retry the preview; if it keeps failing, check the server logs and Epidemic API access.'
              : 'This music preview could not be decoded by your browser. Try another track or use Chrome/Edge.';
            if (!settled) finish(new Error(message));
            else {
              hlsRef.current?.destroy();
              hlsRef.current = null;
              audio.pause();
              setPreviewTrack(null);
              setPreviewPlaying(false);
              setPreviewBusy(false);
              setError(message);
            }
          });
          hls.on(Hls.Events.MANIFEST_PARSED, async () => {
            try { await audio.play(); finish(); }
            catch { finish(new Error('Preview loaded, but your browser blocked playback. Press Play in the audio controls.')); }
          });
          hls.loadSource(url);
          hls.attachMedia(audio);
        });
      } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
        audio.src = url;
        audio.load();
        await audio.play();
      } else throw new Error('HLS music preview is not supported by this browser. Try the latest Chrome, Edge or Safari.');
    } catch (cause) {
      stopPreview(); setPreviewTrack(null); setPreviewPlaying(false); setError(cause.message || 'Could not play this track preview.');
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
      const source = currentMedia.file.raw || currentMedia.file;
      const mixed = String(source.type || '').startsWith('image/')
        ? await mixImageIntoVideo(source, audio, { audioContext, duration: imageDuration, onProgress: setProgress })
        : await mixMusicIntoVideo(source, audio, { audioContext, onProgress: setProgress });
      await onApply(currentMedia.index, mixed, track);
    } catch (cause) { setError(cause.message || 'Could not add this music track.'); }
    finally {
      if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
      setAddingId('');
    }
  };

  return <details className="s2-epidemic" ref={detailsRef}>
    <summary>{summaryLabel}</summary>
    <p>Preview a track, then add it to a video or turn a still image into a short MP4 clip. Editing happens in this browser; your original media stays unchanged. This searches Epidemic Sound’s licensed catalog, not every commercial song.</p>
    {!!mediaFiles.length && mediaFiles.length > 1 && <label className="s2-music-video">Media to soundtrack
      <select value={currentMedia?.index ?? ''} onChange={(event) => onSelectVideo(Number(event.target.value))} disabled={!!addingId}>
        {mediaFiles.map(({ file, index }) => <option key={`${file.name}-${index}`} value={index}>{file.name || `Media ${index + 1}`}</option>)}
      </select>
    </label>}
    {isImage && <label className="s2-image-music-duration">Still-image video length
      <select value={imageDuration} onChange={(event) => setImageDuration(Number(event.target.value))} disabled={!!addingId}>
        {[5, 10, 15, 20, 30, 45, 60].map((seconds) => <option key={seconds} value={seconds}>{seconds} seconds</option>)}
      </select>
      <small>Adding music converts this image to an MP4 video so the soundtrack can play.</small>
    </label>}
    <form onSubmit={search}>
      <input aria-label="Search Epidemic Sound" value={term} onChange={(event) => setTerm(event.target.value)} maxLength={160} placeholder="Search music, artist, mood or genre" />
      <button type="submit" disabled={busy || !!addingId || previewBusy || !term.trim()}>{busy ? 'Searching…' : 'Search tracks'}</button>
    </form>
    {!canAdd && <p className="s2-music-status">Add a photo or video to the editor to use a soundtrack.</p>}
    {previewTrack && <div className="s2-music-player" aria-live="polite"><span><small>NOW PREVIEWING</small><b>{previewTrack.title || previewTrack.name}</b></span><audio ref={audioRef} controls preload="none" onPlay={() => { setPreviewBusy(false); setPreviewPlaying(true); }} onPause={() => setPreviewPlaying(false)} onEnded={() => { setPreviewTrack(null); setPreviewPlaying(false); }} /></div>}
    {addingId && <div className="s2-music-progress" role="status"><span>Mixing music into your video… {progress}% — keep this tab open</span><i><b style={{ width: `${progress}%` }} /></i></div>}
    {error && <p className="s2-music-error" role="alert">{error}</p>}
    {searched && !tracks.length && <p className="s2-music-status">No tracks found for that search.</p>}
    {!!tracks.length && <><div className="s2-music-results-head"><b>Tracks</b><span>{tracks.length}{nextOffset != null ? '+' : ''} found</span></div><ul>{tracks.map((track) => <li key={track.id} className={previewTrack?.id === track.id ? 'is-previewing' : ''}>
      <span><b>{track.title || track.name || 'Untitled track'}</b><small>{artistNames(track) || 'Epidemic Sound'}{track.bpm ? ` · ${track.bpm} BPM` : ''}{track.length ? ` · ${Math.round(track.length / 60)}:${String(track.length % 60).padStart(2, '0')}` : ''}</small></span>
      <div className="s2-music-actions">
        <button type="button" className="s2-music-preview" aria-label={`${previewTrack?.id === track.id && previewPlaying ? 'Pause' : 'Preview'} ${track.title || track.name || 'track'}`} disabled={previewBusy || !!addingId} onClick={() => preview(track)}>{previewTrack?.id === track.id && previewBusy ? 'Loading…' : previewTrack?.id === track.id && previewPlaying ? 'Pause' : 'Preview'}</button>
        <button type="button" aria-label={`${isImage ? 'Add music to image' : 'Add music to video'}: ${track.title || track.name || 'track'}`} disabled={!canAdd || !!addingId || previewBusy} onClick={() => addTrack(track)}>{addingId === track.id ? 'Adding…' : isImage ? 'Add to image' : 'Add to video'}</button>
      </div>
    </li>)}</ul></>}
    {nextOffset != null && <button type="button" className="s2-music-more" disabled={busy || !!addingId || previewBusy} onClick={loadMore}>{busy ? 'Loading…' : 'Load more tracks'}</button>}
  </details>;
}
