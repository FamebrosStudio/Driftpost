export function mp4RecordingType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/mp4;codecs="avc1,mp4a.40.2"',
    'video/mp4',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

export async function mixMusicIntoVideo(videoFile, audioBlob, { audioContext, musicVolume = 0.22, onProgress = () => {}, signal } = {}) {
  const mimeType = mp4RecordingType();
  if (!mimeType) throw new Error('This browser cannot export an MP4 with mixed music. Try the latest Chrome or Edge on desktop.');
  const video = document.createElement('video');
  const music = document.createElement('audio');
  const videoUrl = URL.createObjectURL(videoFile);
  const musicUrl = URL.createObjectURL(audioBlob);
  video.src = videoUrl;
  music.src = musicUrl;
  music.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  music.preload = 'auto';

  let recorder;
  let animation = 0;
  const objectUrls = [videoUrl, musicUrl];
  try {
    await Promise.all([
      new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = () => reject(new Error('Could not read this video.'));
      }),
      new Promise((resolve, reject) => {
        music.oncanplay = resolve;
        music.onerror = () => reject(new Error('Could not read the licensed music file.'));
      }),
    ]);
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('This video has no usable duration.');

    const context = audioContext || new AudioContext();
    if (context.state !== 'running') await context.resume();
    const videoSource = context.createMediaElementSource(video);
    const videoGain = context.createGain();
    videoGain.gain.value = 1;
    // Send source audio only into the recorded stream, not the user's speakers.
    videoSource.connect(videoGain);
    const musicSource = context.createMediaElementSource(music);
    const musicGain = context.createGain();
    musicGain.gain.value = Math.max(0, Math.min(1, musicVolume));
    musicSource.connect(musicGain);
    const audioDestination = context.createMediaStreamDestination();
    videoGain.connect(audioDestination);
    musicGain.connect(audioDestination);

    const capture = video.captureStream?.() || video.mozCaptureStream?.();
    if (!capture?.getVideoTracks().length) throw new Error('This browser cannot capture video for music mixing.');
    const combined = new MediaStream([
      ...capture.getVideoTracks(),
      ...audioDestination.stream.getAudioTracks(),
    ]);
    const chunks = [];
    recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 192_000 });
    const completed = new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error('The browser stopped while making the music video.'));
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/mp4' }));
      signal?.addEventListener('abort', () => {
        if (recorder.state !== 'inactive') recorder.stop();
        reject(new Error('Music mixing was cancelled.'));
      }, { once: true });
    });
    recorder.start(1000);
    const reportProgress = () => {
      onProgress(Math.min(99, Math.floor((video.currentTime / video.duration) * 100)));
      if (!video.ended && recorder?.state === 'recording') animation = requestAnimationFrame(reportProgress);
    };
    video.onended = () => { if (recorder?.state === 'recording') recorder.stop(); };
    video.onerror = () => { if (recorder?.state === 'recording') recorder.stop(); };
    await Promise.all([video.play(), music.play()]);
    reportProgress();
    const output = await completed;
    if (!output.size) throw new Error('The browser created an empty video. Please try again.');
    onProgress(100);
    return new File([output], videoFile.name.replace(/\.[^.]+$/, '') + '-with-music.mp4', { type: 'video/mp4', lastModified: Date.now() });
  } finally {
    cancelAnimationFrame(animation);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    for (const track of video.srcObject?.getTracks?.() || []) track.stop();
    video.pause(); music.pause();
    video.removeAttribute('src'); music.removeAttribute('src');
    video.load(); music.load();
    objectUrls.forEach(URL.revokeObjectURL);
    if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
  }
}
