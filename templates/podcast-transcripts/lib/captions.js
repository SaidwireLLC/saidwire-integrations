// Turns word timings into captions and readable paragraphs. No network and no dependencies.
const text = (w) => w.punctuated_word ?? w.word;
const endsSentence = (w) => /[.!?]["')\]]?$/.test(text(w));

// Line-balanced cues: at most maxLines lines of maxChars, at most maxSeconds on screen, a break at any long pause.
export function buildCues(words, { maxChars = 42, maxLines = 2, maxSeconds = 6, pauseSeconds = 0.8 } = {}) {
  const cues = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    cues.push({ start: cur[0].start, end: cur[cur.length - 1].end, lines: wrap(cur.map(text).join(' '), maxChars) });
    cur = [];
  };
  for (const w of words) {
    if (cur.length) {
      const last = cur[cur.length - 1];
      const tooLong = wrap([...cur, w].map(text).join(' '), maxChars).length > maxLines;
      if (w.start - last.end >= pauseSeconds || w.end - cur[0].start > maxSeconds || tooLong) flush();
    }
    cur.push(w);
    if (endsSentence(w) && cur.map(text).join(' ').length > maxChars) flush();
  }
  flush();
  return cues;
}

// Greedy wrap, then a second pass that evens out two lines so the last one is not a single stray word.
export function wrap(s, maxChars) {
  const lines = [];
  let line = '';
  for (const word of s.split(/\s+/)) {
    if (line && (line + ' ' + word).length > maxChars) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  if (lines.length === 2) {
    const words = s.split(/\s+/);
    let best = lines, bestGap = Math.abs(lines[0].length - lines[1].length);
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      if (a.length <= maxChars && b.length <= maxChars && Math.abs(a.length - b.length) < bestGap) { best = [a, b]; bestGap = Math.abs(a.length - b.length); }
    }
    return best;
  }
  return lines;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
function stamp(seconds, sep) {
  const ms = Math.round(seconds * 1000);
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${sep}${pad(ms % 1000, 3)}`;
}
export const clock = (seconds) => stamp(seconds, '.').slice(0, 8);

export const toSrt = (cues) => cues.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.lines.join('\n')}\n`).join('\n');
export const toVtt = (cues) => `WEBVTT\n\n${cues.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.lines.join('\n')}\n`).join('\n')}`;

// Paragraphs for reading: a new one at a long pause, or at a sentence end once it has run long enough.
export function buildParagraphs(words, { pauseSeconds = 2, maxSeconds = 60 } = {}) {
  const out = [];
  let cur = [];
  const flush = () => {
    if (cur.length) out.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map(text).join(' ') });
    cur = [];
  };
  for (const w of words) {
    const last = cur[cur.length - 1];
    if (last && (w.start - last.end >= pauseSeconds || (w.start - cur[0].start >= maxSeconds && endsSentence(last)))) flush();
    cur.push(w);
  }
  flush();
  return out;
}
