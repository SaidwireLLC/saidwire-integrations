// Makes SRT and WebVTT captions for an audio or video file. Run: node make-captions.js talk.mp4
import { writeFile } from 'node:fs/promises';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transcribeLongFile } from './lib/audio.js';
import { buildCues, toSrt, toVtt } from './lib/captions.js';
import { getConfig, loadEnv, transcribeBytes } from './lib/saidwire.js';

// Only the audio track is sent. It is far smaller than the video, and it is what the timings are measured against.
export async function makeCaptions(input, { config = getConfig(), chunkSeconds, onProgress } = {}) {
  const send = (bytes, contentType) => transcribeBytes(bytes, { contentType, config });
  const { words, seconds, pieces } = await transcribeLongFile(input, send, { chunkSeconds, onProgress });
  const cues = buildCues(words);
  return { cues, srt: toSrt(cues), vtt: toVtt(cues), seconds, pieces };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  loadEnv(join(here, '.env'));
  const input = process.argv[2];
  if (!input) { console.error('Usage: node make-captions.js <video or audio file>'); process.exit(1); }
  try {
    const out = await makeCaptions(input, { onProgress: ({ done, total }) => console.log(`Transcribed part ${done} of ${total}`) });
    const { dir, name } = parse(input);
    await writeFile(join(dir, `${name}.srt`), out.srt);
    await writeFile(join(dir, `${name}.vtt`), out.vtt);
    console.log(`Wrote ${name}.srt and ${name}.vtt: ${out.cues.length} captions from ${Math.round(out.seconds)} s of audio.`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
