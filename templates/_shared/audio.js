// ffmpeg helpers: make small mono audio from any audio or video file, and split long files at a quiet moment.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err = (err + d).slice(-200000); });
    p.on('error', (e) => reject(e.code === 'ENOENT' ? new Error(`${cmd} is not installed. Install ffmpeg first: https://ffmpeg.org/download.html`) : e));
    p.on('close', (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(`${cmd} could not read this file: ${err.trim().split('\n').pop()}`))));
  });
}

export async function durationSeconds(path) {
  const { out } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]);
  const d = Number(out.trim());
  if (!Number.isFinite(d)) throw new Error('Could not read the length of this file.');
  return d;
}

// Mono 16 kHz MP3 at 64 kbps is about 29 MB an hour, and drops the picture from video files.
// Sending audio only also keeps caption timing tied to one clean audio track.
export async function extractAudio(input, output, { start, length } = {}) {
  const range = [...(start ? ['-ss', String(start)] : []), ...(length ? ['-t', String(length)] : [])];
  await run('ffmpeg', ['-v', 'error', '-y', ...range, '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '64k', output]);
}

// Silence ends that fall near each cut point, from ffmpeg's silencedetect filter.
export async function quietMoments(path) {
  const { err } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-af', 'silencedetect=noise=-35dB:d=0.3', '-f', 'null', '-']);
  const out = [];
  for (const m of err.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)) out.push((Number(m[1]) + Number(m[2])) / 2);
  return out;
}

// Cut points for a file. Each piece is at most chunkSeconds. A cut moves back to a quiet moment when one is
// close, so a word is not sliced in two. With no quiet moment nearby it cuts at the limit.
export function planPieces(total, chunkSeconds, quiet = [], searchSeconds = Math.min(60, chunkSeconds / 4)) {
  const pieces = [];
  let start = 0;
  while (total - start > chunkSeconds) {
    const limit = start + chunkSeconds;
    const near = quiet.filter((t) => t <= limit && t >= limit - searchSeconds);
    const cut = near.length ? near[near.length - 1] : limit;
    pieces.push({ start, length: cut - start });
    start = cut;
  }
  pieces.push({ start, length: total - start });
  return pieces;
}

// Runs fn over items with a limit on how many run at once, and keeps the results in order.
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Transcribes any local audio or video file of any length. One API request per piece, two at once (the per-key limit).
// Returns words with times in seconds from the start of the file.
export async function transcribeLongFile(input, transcribe, { chunkSeconds = 3000, onProgress = () => {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'saidwire-'));
  try {
    const whole = join(dir, 'whole.mp3');
    await extractAudio(input, whole);
    const total = await durationSeconds(whole);
    const quiet = total > chunkSeconds ? await quietMoments(whole) : [];
    const pieces = planPieces(total, chunkSeconds, quiet);
    let done = 0;
    const parts = await mapLimit(pieces, 2, async (piece, i) => {
      let path = whole;
      if (pieces.length > 1) {
        path = join(dir, `piece${i}.mp3`);
        await extractAudio(whole, path, piece);
      }
      const result = await transcribe(await readFile(path), 'audio/mpeg');
      onProgress({ done: ++done, total: pieces.length });
      return { piece, result };
    });
    const words = parts.flatMap(({ piece, result }) => (result?.results?.channels?.[0]?.alternatives?.[0]?.words ?? [])
      .map((w) => ({ ...w, start: w.start + piece.start, end: w.end + piece.start })));
    return { words, seconds: total, pieces: pieces.length };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
