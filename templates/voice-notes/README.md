# Voice notes

Talk into the browser, watch the words appear, and keep the note.

- Live words over a WebSocket, relayed through your own server
- Sends plain 16-bit audio, not a browser-specific format. Tested in Chrome
- Notes are saved in `data/notes.json`, so there is nothing to set up

## Run it

Needs Node 20.12 or newer.

```bash
npm install
cp .env.example .env     # then put your key in .env
npm start                # http://127.0.0.1:3000
```

Get a key at https://saidwire.com/dev: 120 free hours, no card.

## How the key stays safe

The browser connects to `/live` on this server. The server opens the stream to Saidwire with the key from `.env`. The key is never sent to the browser.

The server accepts connections only from its own pages, and allows 4 streams at once, the limit for a new key.

**Before you deploy for other people:** add your own login check in the `allowed` function in `server.js`. Anyone who can reach the relay can spend your audio hours. Set `ALLOWED_ORIGIN` to your site's address.

## Deploy

Use a host that keeps a WebSocket open and has a disk, or swap the two storage functions at the top of `server.js` for your database. Browsers allow the microphone only on `https://` or `localhost`.

## Limits

English only. No speaker labels. Words depend on the microphone and the room, so try it on your own audio.

## Tests

```bash
npm test
```

Tests run on your computer with a stand-in server. They need no key and no network, so they never spend audio hours.
