# Add Saidwire with Replit

Paste this into Replit. Replace the part in [brackets].

````text
Add transcription to my app using Saidwire. What I want: [describe it, e.g. a Record button that saves what I said as a note].

How to build it here
Use a small always-on server in this Repl (Node or Python, whichever the project uses). This host can run a WebSocket relay, so live words are fine if I ask for them.

Rules
- Put the key in a server-side secret called SAIDWIRE_API_KEY. Ask me to add it in the Secrets tool. Read it from the environment.
- Never put the key in browser or mobile code, in a repo, or in a variable with a client prefix (NEXT_PUBLIC_, VITE_, EXPO_PUBLIC_, REACT_APP_). Do not ask me to paste the key into this chat.
- The browser must call my own server route, and that route calls Saidwire. There are no short-lived browser tokens.
- That route spends my audio hours, so protect it with my app's login. If the app has no login yet, tell me, and allow only my own site's origin for now.
- Use plain HTTP calls. No other speech SDK is needed.

Saidwire API facts (use exactly these, do not guess)
- Docs for AI tools: https://saidwire.com/llms.txt
- Auth header: Authorization: Token <key>. Keys come from https://saidwire.com/dev (120 free hours, no card).
- File: POST https://api.saidwire.com/v1/listen?punctuate=true with the raw audio as the body and a Content-Type such as audio/webm. Text is at results.channels[0].alternatives[0].transcript. Word timings are in .words[] (punctuated_word, start, end). Add utterances=true for results.utterances[].
- File already online: same URL, Content-Type: application/json, body {"url": "<public or signed link>"}. It must download within 30 seconds.
- Subtitles: POST https://api.saidwire.com/v1/audio/transcriptions, multipart fields file, model=saidwire-en, response_format=srt or vtt. Use header Authorization: Bearer <key> here.
- Formats: WAV, MP3, FLAC, Ogg/Opus, WebM. Limits: 100 MB and 60 minutes per request, 2 file requests at once per key. The request waits for the full result. There are no callbacks or webhooks.
- For video, extract the audio on the server first. Do not send the video file.
- Recording in the browser: use MediaRecorder with audio/webm;codecs=opus if MediaRecorder.isTypeSupported says yes. If not, capture 16-bit PCM with an AudioWorklet and build a WAV.
- Live words: wss://api.saidwire.com/v1/listen?encoding=linear16&sample_rate=<rate>&interim_results=true&punctuate=true with the same auth header, sent from my server. Send binary audio in real time, 20-100 ms at a time. Send {"type":"KeepAlive"} if no audio is flowing (the stream closes after 10 seconds of nothing) and {"type":"CloseStream"} when done. Replace the shown text on each is_final:false message. Keep text from is_final:true messages.
- English only. Mono only.
- Not available: speaker labels, key-term boosting, redaction, number formatting, translation, summaries. diarize, keyterm, keywords, redact, numerals, multichannel, summarize and callback are accepted but silently ignored, so do not use them or build UI for them. confidence is always 0.95, so do not show it.
- Errors: 401 bad key. 402, or 429 with insufficient_quota: hours used up, do not retry. 413: too big or too long. Other 429 and 5xx: wait for Retry-After, then retry. Show the user a plain message and log the x-request-id header.

Finish
When it works, tell me which deployment type keeps the relay running, and how to test with a 10-second recording.
````
