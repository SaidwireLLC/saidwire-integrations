// Podcast transcripts. Give it a local file, a link to an audio file, or a podcast feed.
//   node transcribe.js episode.mp3
//   node transcribe.js https://example.com/feed.xml --latest 3
// Only transcribe shows you own or have permission to use.
import { createWriteStream, existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, parse } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseFeed, slug } from './feed.js';
import { transcribeLongFile } from './lib/audio.js';
import { getConfig, loadEnv, transcribeBytes } from './lib/saidwire.js';
import { writeEpisode } from './render.js';

async function download(url, path) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Could not download ${url} (HTTP ${res.status}).`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(path));
}

// Works out what the source is: a list of { title, file } or { title, url }.
export async function resolveSource(source, latest) {
  if (!/^https?:\/\//.test(source)) return [{ title: parse(source).name, file: source }];
  const res = await fetch(source, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Could not open ${source} (HTTP ${res.status}).`);
  const type = res.headers.get('content-type') || '';
  if (/xml|rss/.test(type) || /\.(xml|rss)(\?|$)/.test(source)) {
    const { episodes } = parseFeed(await res.text());
    if (!episodes.length) throw new Error('No audio episodes found in that feed.');
    return episodes.slice(0, latest);
  }
  await res.body?.cancel();
  return [{ title: parse(new URL(source).pathname).name || 'episode', url: source }];
}

export async function transcribeEpisode(episode, { outDir, config = getConfig(), chunkSeconds, log = console.log }) {
  const dir = join(outDir, slug(episode.title));
  if (existsSync(join(dir, 'transcript.md'))) { log(`Skipping "${episode.title}": already done.`); return { skipped: true, dir, seconds: 0 }; }
  const temp = await mkdtemp(join(tmpdir(), 'podcast-'));
  try {
    let file = episode.file;
    if (!file) {
      log(`Downloading "${episode.title}"`);
      file = join(temp, basename(new URL(episode.url).pathname) || 'episode');
      await download(episode.url, file);
    }
    log(`Transcribing "${episode.title}"`);
    const send = (bytes, contentType) => transcribeBytes(bytes, { contentType, config });
    const { words, seconds, pieces } = await transcribeLongFile(file, send, { chunkSeconds, onProgress: ({ done, total }) => { if (total > 1) log(`  part ${done} of ${total}`); } });
    await writeEpisode(dir, episode.title, words);
    log(`  ${words.length} words from ${Math.round(seconds / 60)} min of audio -> ${dir}`);
    return { skipped: false, dir, seconds, pieces, words: words.length };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  loadEnv(join(here, '.env'));
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { latest: { type: 'string', default: '1' }, out: { type: 'string', default: 'out' } } });
  if (!positionals[0]) { console.error('Usage: node transcribe.js <file, audio link or feed link> [--latest 3] [--out out]'); process.exit(1); }
  try {
    const config = getConfig();
    for (const episode of await resolveSource(positionals[0], Number(values.latest))) await transcribeEpisode(episode, { outDir: values.out, config });
  } catch (e) { console.error(e.message); process.exit(1); }
}
