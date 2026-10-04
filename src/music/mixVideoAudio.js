export function mp4RecordingType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaStream === 'undefined') return '';
  const candidates = [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/mp4;codecs="avc1,mp4a.40.2"',
    'video/mp4',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

export async function mixImageIntoVideo(imageFile, audioBlob, { audioContext, musicVolume = 0.22, duration = 15, onProgress = () => {} } = {}) {
  const mimeType = mp4RecordingType();
  if (!mimeType || !HTMLCanvasElement.prototype.captureStream) throw new Error('This browser cannot turn an image into an MP4 with music. Try the latest Chrome or Edge.');
  if (!(imageFile instanceof Blob) || !imageFile.size) throw new Error('Choose a valid image before adding music.');
  if (!(audioBlob instanceof Blob) || !audioBlob.size) throw new Error('The music download was empty. Please choose the track again.');
  const seconds = Math.max(5, Math.min(60, Number(duration) || 15));
  const imageUrl = URL.createObjectURL(imageFile);
  const audioUrl = URL.createObjectURL(audioBlob);
  const image = new Image();
  const music = document.createElement('audio');
  music.preload = 'auto';
  music.loop = true;
  let capture;
  let combined;
  let destination;
  let recorder;
  let animation = 0;
  let timer;
  let localContext = false;
  let context;
  try {
    const imageReady = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Could not decode this image. Try a JPG, PNG or WebP.'));
    });
    image.src = imageUrl;
    const musicReady = new Promise((resolve, reject) => {
      let readyTimer = setTimeout(() => reject(new Error('Music took too long to load. Check your connection and try again.')), 30_000);
      const done = () => { clearTimeout(readyTimer); resolve(); };
      music.addEventListener('canplay', done, { once: true });
      music.addEventListener('error', () => { clearTimeout(readyTimer); reject(new Error('Could not decode the downloaded music track.')); }, { once: true });
    });
    music.src = audioUrl;
    await Promise.all([imageReady, musicReady]);
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create the image video canvas.');
    const draw = () => {
      ctx.fillStyle = '#08090c';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      ctx.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    };
    draw();
    capture = canvas.captureStream(30);
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error('This browser cannot mix music into the image video.');
    context = audioContext || new Context();
    localContext = !audioContext;
    if (context.state !== 'running') await context.resume();
    const source = context.createMediaElementSource(music);
    const gain = context.createGain();
    gain.gain.value = Math.max(0, Math.min(1, musicVolume));
    source.connect(gain);
    destination = context.createMediaStreamDestination();
    gain.connect(destination);
    combined = new MediaStream([...capture.getVideoTracks(), ...destination.stream.getAudioTracks()]);
    recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 192_000 });
    const chunks = [];
    const completed = new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error('The browser stopped while creating the image video. Try again in Chrome or Edge.'));
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || mimeType }));
    });
    const startedAt = performance.now();
    const drawFrame = () => {
      draw();
      const elapsed = (performance.now() - startedAt) / 1000;
      onProgress(Math.min(99, Math.floor((elapsed / seconds) * 100)));
      if (elapsed < seconds && recorder.state === 'recording') animation = requestAnimationFrame(drawFrame);
      else if (recorder.state === 'recording') recorder.stop();
    };
    timer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, seconds * 1000 + 5000);
    recorder.start(500);
    try { await music.play(); }
    catch (cause) {
      try { recorder.stop(); } catch {}
      await completed.catch(() => {});
      throw new Error(cause?.name === 'NotAllowedError' ? 'Your browser blocked music playback. Press Add to video again and allow playback in this tab.' : 'Could not start the music track. Try again.');
    }
    drawFrame();
    const output = await completed;
    if (!output.size) throw new Error('The image video was empty. Please try again.');
    onProgress(100);
    const name = String(imageFile.name || 'image').replace(/\.[a-z0-9]+$/i, '');
    return new File([output], `${name}-with-music.mp4`, { type: 'video/mp4', lastModified: Date.now() });
  } finally {
    cancelAnimationFrame(animation);
    clearTimeout(timer);
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch {}
    for (const stream of [combined, capture, destination?.stream]) stream?.getTracks().forEach((track) => track.stop());
    music.pause();
    music.removeAttribute('src');
    music.load();
    image.removeAttribute('src');
    URL.revokeObjectURL(imageUrl);
    URL.revokeObjectURL(audioUrl);
    if (localContext && context?.state !== 'closed') await context?.close?.().catch(() => {});
  }
}

export async function mixMusicIntoVideo(videoFile, audioBlob, { audioContext, musicVolume = 0.22, onProgress = () => {}, signal } = {}) {
  const mimeType = mp4RecordingType();
  if (!mimeType) throw new Error('This browser cannot export an MP4 with mixed music. Try the latest Chrome or Edge on desktop.');
  if (!(videoFile instanceof Blob) || !videoFile.size) throw new Error('Choose a valid video before adding music.');
  if (!(audioBlob instanceof Blob) || !audioBlob.size) throw new Error('The music download was empty. Please choose the track again.');
  if (signal?.aborted) throw new Error('Music mixing was cancelled.');
  const video = document.createElement('video');
  const music = document.createElement('audio');
  const videoUrl = URL.createObjectURL(videoFile);
  const musicUrl = URL.createObjectURL(audioBlob);
  music.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  music.preload = 'auto';

  let recorder;
  let animation = 0;
  let capture;
  let combined;
  let audioDestination;
  let abortHandler;
  let stopTimer;
  try {
    const waitFor = (media, eventName, message, timeout = 30_000) => new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        media.removeEventListener(eventName, ready);
        media.removeEventListener('error', failed);
      };
      const ready = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error(message)); };
      media.addEventListener(eventName, ready, { once: true });
      media.addEventListener('error', failed, { once: true });
      timer = setTimeout(() => { cleanup(); reject(new Error(`${message} Loading timed out; check your connection and retry.`)); }, timeout);
    });
    const videoReady = waitFor(video, 'loadedmetadata', 'Could not read this video.');
    video.src = videoUrl;
    video.load();
    await videoReady;
    const musicReady = waitFor(music, 'canplay', 'Could not read the downloaded music track.');
    music.src = musicUrl;
    music.load();
    await musicReady;
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('This video has no usable duration.');
    if (!video.videoWidth || !video.videoHeight) throw new Error('This video has no readable picture frames.');

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
    audioDestination = context.createMediaStreamDestination();
    videoGain.connect(audioDestination);
    musicGain.connect(audioDestination);

    capture = video.captureStream?.() || video.mozCaptureStream?.();
    if (!capture?.getVideoTracks().length) throw new Error('This browser cannot capture video for music mixing.');
    combined = new MediaStream([
      ...capture.getVideoTracks(),
      ...audioDestination.stream.getAudioTracks(),
    ]);
    const chunks = [];
    recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 192_000 });
    let recordingFailure = null;
    const completed = new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
      recorder.onerror = () => {
        recordingFailure = new Error('The browser stopped while making the music video. Try a shorter clip or another browser.');
        if (recorder.state !== 'inactive') recorder.stop();
      };
      recorder.onstop = () => recordingFailure ? reject(recordingFailure) : resolve(new Blob(chunks, { type: 'video/mp4' }));
      abortHandler = () => {
        recordingFailure = new Error('Music mixing was cancelled.');
        if (recorder.state !== 'inactive') recorder.stop();
      };
      signal?.addEventListener('abort', abortHandler, { once: true });
    });
    recorder.start(1000);
    const reportProgress = () => {
      onProgress(Math.min(99, Math.floor((video.currentTime / video.duration) * 100)));
      if (!video.ended && recorder?.state === 'recording') animation = requestAnimationFrame(reportProgress);
    };
    video.onended = () => { if (recorder?.state === 'recording') recorder.stop(); };
    video.onerror = () => {
      recordingFailure = new Error('The source video could not be decoded while mixing. Try exporting it as MP4 or WebM first.');
      if (recorder?.state === 'recording') recorder.stop();
    };
    stopTimer = setTimeout(() => {
      recordingFailure = new Error('Music mixing took too long and was stopped. Try a shorter video.');
      if (recorder?.state === 'recording') recorder.stop();
    }, Math.max(60_000, video.duration * 3000 + 60_000));
    let playbackFailure = null;
    try { await Promise.all([video.play(), music.play()]); }
    catch (cause) {
      playbackFailure = new Error(cause?.name === 'NotAllowedError'
        ? 'Your browser blocked audio playback. Press Add to video again, then allow playback in this tab.'
        : 'The video or music could not start. Try the track again in Chrome or Edge.');
      recordingFailure = playbackFailure;
      if (recorder.state !== 'inactive') recorder.stop();
    }
    reportProgress();
    const output = await completed;
    if (playbackFailure) throw playbackFailure;
    if (!output.size) throw new Error('The browser created an empty video. Please try again.');
    onProgress(100);
    return new File([output], videoFile.name.replace(/\.[^.]+$/, '') + '-with-music.mp4', { type: 'video/mp4', lastModified: Date.now() });
  } finally {
    cancelAnimationFrame(animation);
    clearTimeout(stopTimer);
    signal?.removeEventListener('abort', abortHandler);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    for (const stream of [combined, capture, audioDestination?.stream]) {
      for (const track of stream?.getTracks?.() || []) track.stop();
    }
    video.pause(); music.pause();
    video.removeAttribute('src'); music.removeAttribute('src');
    video.load(); music.load();
    objectUrls.forEach(URL.revokeObjectURL);
    if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
  }
}
