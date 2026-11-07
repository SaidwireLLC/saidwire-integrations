# Video captions

Make SRT and WebVTT captions for a video, and preview them on the video in your browser.

- Sends only the audio track to Saidwire, which is far smaller than the video
- Caption lines stay readable: at most 2 lines of 42 characters, and 6 seconds on screen
- Files over 50 minutes are split at a quiet moment and joined back up, two parts at a time

## Run it

Needs Node 20.12 or newer, and [ffmpeg](https://ffmpeg.org/download.html).

```bash
cp .env.example .env               # then put your key in .env
node make-captions.js talk.mp4     # writes talk.srt and talk.vtt
npm start                          # or use the web page: http://127.0.0.1:3002
```

Get a key at https://saidwire.com/dev: 120 free hours, no card.

## How the key stays safe

The browser uploads to this server, and this server calls Saidwire with the key from `.env`. It accepts uploads only from its own page, and deletes the upload when the captions are done.

**Before you deploy for other people:** add your own login check in the `allowed` function in `server.js`, and set `ALLOWED_ORIGIN` to your site's address. Anyone who can upload can spend your audio hours.

## Deploy

This needs ffmpeg and room for large uploads, so use your own computer, a server, or a container host. It will not fit in a small serverless function. `MAX_UPLOAD_MB` sets the upload limit (default 2048).

## Limits

- English only. No speaker labels.
- There is no number formatting, so numbers may appear as words.
- If a long file has no quiet moment near a cut, the word at that cut can appear twice. Spot-check those places.
- Check captions before you publish them. Names and technical terms are the most likely errors.

## Tests

```bash
npm test
```

Tests run on your computer with a stand-in server. They need no key and no network, so they never spend audio hours.
