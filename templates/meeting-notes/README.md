# Meeting notes

Upload a meeting recording, and get a timestamped transcript with decisions, action items and open questions.

- One file in, Markdown out, with copy and download buttons
- No dependencies, and nothing is written to disk
- The notes are simple keyword rules in `notes.js`. They run with nothing to set up

## Run it

Needs Node 20.12 or newer.

```bash
cp .env.example .env     # then put your key in .env
npm start                # http://127.0.0.1:3001
```

Get a key at https://saidwire.com/dev: 120 free hours, no card.

## Better notes

For real summaries, pass the `paragraphs` from `buildNotes` to the language model you already use, and replace `buildHighlights` in `notes.js`.

## Files it takes

WAV, MP3, FLAC, Ogg, WebM or AAC, up to 60 minutes and 100 MB. For a video or an `.m4a` file, make an MP3 first:

```bash
ffmpeg -i meeting.mp4 -vn -ac 1 -ar 16000 -b:a 64k meeting.mp3
```

## How the key stays safe

The browser uploads to this server, and this server calls Saidwire with the key from `.env`. It accepts uploads only from its own page.

**Before you deploy for other people:** add your own login check in the `allowed` function in `server.js`, and set `ALLOWED_ORIGIN` to your site's address. Anyone who can upload can spend your audio hours.

## Limits

- English only.
- **No speaker labels.** The transcript does not say who said what.
- Long files need a host that allows large uploads and long requests. On hosts with small limits, upload to storage first, and send Saidwire a signed link as `{"url": "..."}`.
- Keyword rules miss things. Read the transcript before you rely on the notes.

## Tests

```bash
npm test
```

Tests run on your computer with a stand-in server. They need no key and no network, so they never spend audio hours.
