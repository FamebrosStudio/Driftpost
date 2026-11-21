import test from 'node:test';
import assert from 'node:assert/strict';
import { isInstagramCompatibleVideo } from '../src/instagram-video.js';

const compatible = {
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
  streams: [
    { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 1080, height: 1920, avg_frame_rate: '30000/1001' },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
};

test('Instagram video compatibility accepts standard MP4 H.264/AAC media', () => {
  assert.equal(isInstagramCompatibleVideo(compatible), true);
});

test('Instagram video compatibility rejects media requiring normalization', () => {
  assert.equal(isInstagramCompatibleVideo({
    ...compatible,
    streams: [{ ...compatible.streams[0], codec_name: 'hevc' }, compatible.streams[1]],
  }), false);
  assert.equal(isInstagramCompatibleVideo({
    ...compatible,
    streams: [{ ...compatible.streams[0], pix_fmt: 'yuv422p' }, compatible.streams[1]],
  }), false);
  assert.equal(isInstagramCompatibleVideo({
    ...compatible,
    streams: [{ ...compatible.streams[0], width: 2560 }, compatible.streams[1]],
  }), false);
});
