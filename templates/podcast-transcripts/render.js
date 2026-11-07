// Writes one episode's files: a readable transcript, captions, word timings and a web page.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildCues, buildParagraphs, clock, toSrt, toVtt } from './lib/captions.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toMarkdown(title, paragraphs) {
  return [`# ${title}`, '', ...paragraphs.map((p) => `[${clock(p.start)}] ${p.text}\n`)].join('\n');
}

export function toHtml(title, paragraphs) {
  const body = paragraphs.map((p) => `<p><time>${clock(p.start)}</time> ${esc(p.text)}</p>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}: transcript</title>
<style>:root{color-scheme:light dark}body{font:18px/1.6 system-ui,sans-serif;max-width:680px;margin:0 auto;padding:24px 16px}time{display:block;font-size:13px;opacity:.6}</style>
</head><body><h1>${esc(title)}</h1>
${body}
</body></html>
`;
}

export async function writeEpisode(dir, title, words) {
  await mkdir(dir, { recursive: true });
  const paragraphs = buildParagraphs(words);
  const cues = buildCues(words);
  await Promise.all([
    writeFile(join(dir, 'captions.srt'), toSrt(cues)),
    writeFile(join(dir, 'captions.vtt'), toVtt(cues)),
    writeFile(join(dir, 'words.json'), JSON.stringify(words)),
    writeFile(join(dir, 'index.html'), toHtml(title, paragraphs)),
  ]);
  await writeFile(join(dir, 'transcript.md'), toMarkdown(title, paragraphs));   // written last: it marks the episode as done
}
