// Turns a Saidwire result into meeting notes. The rules below are simple keyword matches, so they run with nothing else
// to set up. To get real summaries, pass `paragraphs` to the language model you already use and replace buildHighlights.
import { buildParagraphs, clock } from './lib/captions.js';
import { firstAlternative } from './lib/saidwire.js';

const ACTION = /\b(action items?|to-?do|follow[- ]up|next steps?|i'll|i will|we'll|we will|you'll|you will|we need to|i need to|needs? to|let's make sure|by (monday|tuesday|wednesday|thursday|friday|tomorrow|next week|end of (the )?(day|week|month)))\b/i;
const DECISION = /\b(we decided|we've decided|decision|we agreed|we're going with|let's go with|we'll go with|approved)\b/i;

// One entry per sentence, each with the time it starts.
export function sentences(words) {
  const out = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    if (/[.!?]["')\]]?$/.test(w.punctuated_word ?? w.word)) {
      out.push({ start: cur[0].start, text: cur.map((x) => x.punctuated_word ?? x.word).join(' ') });
      cur = [];
    }
  }
  if (cur.length) out.push({ start: cur[0].start, text: cur.map((x) => x.punctuated_word ?? x.word).join(' ') });
  return out;
}

export function buildHighlights(list) {
  const decisions = list.filter((s) => DECISION.test(s.text));
  const actions = list.filter((s) => ACTION.test(s.text) && !decisions.includes(s));
  const questions = list.filter((s) => s.text.trim().endsWith('?'));
  return { decisions, actions, questions };
}

const bullets = (items) => (items.length ? items.map((s) => `- [${clock(s.start)}] ${s.text}`).join('\n') : '- None found');

export function buildNotes(result, { title = 'Meeting' } = {}) {
  const { words = [] } = firstAlternative(result);
  const seconds = result?.metadata?.duration ?? 0;
  const paragraphs = buildParagraphs(words);
  const highlights = buildHighlights(sentences(words));
  const markdown = [
    `# ${title}`, '', `Length: ${clock(seconds)}`, '',
    '## Decisions', bullets(highlights.decisions), '',
    '## Action items', bullets(highlights.actions), '',
    '## Open questions', bullets(highlights.questions), '',
    '## Transcript', ...paragraphs.map((p) => `[${clock(p.start)}] ${p.text}\n`),
  ].join('\n');
  return { title, seconds, paragraphs, ...highlights, markdown, requestId: result?.metadata?.request_id };
}
