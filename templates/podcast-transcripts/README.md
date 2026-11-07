# Podcast transcripts

Turn an episode, a link or a whole feed into a transcript, captions and a web page.

For each episode you get `transcript.md`, `captions.srt`, `captions.vtt`, `words.json` and `index.html`.

- Reads a podcast feed and takes the latest episodes
- Episodes of any length: over 50 minutes they are split at a quiet moment and joined back up
- A finished episode is skipped on the next run, so you never pay for it twice

## Run it

Needs Node 20.12 or newer, and [ffmpeg](https://ffmpeg.org/download.html).

```bash
cp .env.example .env                                     # then put your key in .env
node transcribe.js episode.mp3
node transcribe.js https://example.com/episode.mp3
node transcribe.js https://example.com/feed.xml --latest 3
```

Output goes to `out/<episode>/`. Change it with `--out`.

Get a key at https://saidwire.com/dev: 120 free hours, no card.

Only transcribe shows you own or have permission to use.

## How the key stays safe

This is a command-line tool, so the key stays in `.env` on your machine. The pages it writes hold only the transcript.

## Cost

You pay for audio length, including silence and music. At $0.30 per audio hour, a 45-minute episode is about $0.23. The free 120 hours covers about 160 episodes that long.

## Limits

- English only.
- **No speaker labels.** Transcripts do not say who is speaking.
- Music and heavy crosstalk can produce wrong or missing words. Read a transcript before you publish it.
- If a long episode has no quiet moment near a cut, the word at that cut can appear twice.

## Tests

```bash
npm test
```

Tests run on your computer with a stand-in server. They need no key and no network, so they never spend audio hours.
