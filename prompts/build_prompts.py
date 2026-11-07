#!/usr/bin/env python3
"""Writes one copy-paste prompt per tool. The API facts live here once, so no prompt can drift from the others."""
import pathlib

HERE = pathlib.Path(__file__).parent

RULES = """Rules
- Put the key in a server-side secret called SAIDWIRE_API_KEY. {secret}
- Never put the key in browser or mobile code, in a repo, or in a variable with a client prefix (NEXT_PUBLIC_, VITE_, EXPO_PUBLIC_, REACT_APP_). Do not ask me to paste the key into this chat.
- The browser must call my own server route, and that route calls Saidwire. There are no short-lived browser tokens.
- That route spends my audio hours, so protect it with my app's login. If the app has no login yet, tell me, and allow only my own site's origin for now.
- Use plain HTTP calls. No other speech SDK is needed."""

FACTS = """Saidwire API facts (use exactly these, do not guess)
- Docs for AI tools: https://saidwire.com/llms.txt
- Auth header: Authorization: Token <key>. Keys come from https://saidwire.com/dev (120 free hours, no card).
- File: POST https://api.saidwire.com/v1/listen?punctuate=true with the raw audio as the body and a Content-Type such as audio/webm. Text is at results.channels[0].alternatives[0].transcript. Word timings are in .words[] (punctuated_word, start, end). Add utterances=true for results.utterances[].
- File already online: same URL, Content-Type: application/json, body {{"url": "<public or signed link>"}}. It must download within 30 seconds.
- Subtitles: POST https://api.saidwire.com/v1/audio/transcriptions, multipart fields file, model=saidwire-en, response_format=srt or vtt. Use header Authorization: Bearer <key> here.
- Formats: WAV, MP3, FLAC, Ogg/Opus, WebM. Limits: 100 MB and 60 minutes per request, 2 file requests at once per key. The request waits for the full result. There are no callbacks or webhooks.
- For video, extract the audio on the server first. Do not send the video file.
- Recording in the browser: use MediaRecorder with audio/webm;codecs=opus if MediaRecorder.isTypeSupported says yes. If not, capture 16-bit PCM with an AudioWorklet and build a WAV.
- Live words: wss://api.saidwire.com/v1/listen?encoding=linear16&sample_rate=<rate>&interim_results=true&punctuate=true with the same auth header, sent from my server. Send binary audio in real time, 20-100 ms at a time. Send {{"type":"KeepAlive"}} if no audio is flowing (the stream closes after 10 seconds of nothing) and {{"type":"CloseStream"}} when done. Replace the shown text on each is_final:false message. Keep text from is_final:true messages.
- English only. Mono only.
- Not available: speaker labels, key-term boosting, redaction, number formatting, translation, summaries. diarize, keyterm, keywords, redact, numerals, multichannel, summarize and callback are accepted but silently ignored, so do not use them or build UI for them. confidence is always 0.95, so do not show it.
- Errors: 401 bad key. 402, or 429 with insufficient_quota: hours used up, do not retry. 413: too big or too long. Other 429 and 5xx: wait for Retry-After, then retry. Show the user a plain message and log the x-request-id header."""

ASK = "Add transcription to my app using Saidwire. What I want: [describe it, e.g. a Record button that saves what I said as a note]."

# name, file, what to do in this tool, how secrets work there, closing steps
TOOLS = [
    ("Cursor", "cursor", "Look at my project first and use its existing server framework and file layout. If it has no server, add the smallest one that fits.",
     "Read it from the environment, add it to .env (and confirm .env is in .gitignore), and add a placeholder to .env.example.",
     "Add a short .cursor/rules/saidwire.mdc with the key rule and the limits above, so later edits keep to them. Then run the app and tests."),
    ("Claude Code", "claude-code", "Read the project first and use its existing server framework and file layout. If it has no server, add the smallest one that fits. Tell me your plan in a few lines, then build it.",
     "Read it from the environment, add it to .env (and confirm .env is in .gitignore), and add a placeholder to .env.example.",
     "Add a short section to CLAUDE.md with the key rule and the limits above, so later sessions keep to them. Then run the app and tests."),
    ("Windsurf", "windsurf", "Look at my project first and use its existing server framework and file layout. If it has no server, add the smallest one that fits.",
     "Read it from the environment, add it to .env (and confirm .env is in .gitignore), and add a placeholder to .env.example.",
     "Add a project rule with the key rule and the limits above, so later edits keep to them. Then run the app and tests."),
    ("GitHub Copilot", "github-copilot", "Work in agent mode. Look at my project first and use its existing server framework and file layout. If it has no server, add the smallest one that fits.",
     "Read it from the environment, add it to .env (and confirm .env is in .gitignore), and add a placeholder to .env.example.",
     "Add the key rule and the limits above to .github/copilot-instructions.md, so later edits keep to them. Then run the app and tests."),
    ("Codex", "codex", "Read the project first and use its existing server framework and file layout. If it has no server, add the smallest one that fits.",
     "Read it from the environment, add it to .env (and confirm .env is in .gitignore), and add a placeholder to .env.example.",
     "Add the key rule and the limits above to AGENTS.md, so later runs keep to them. Then run the app and tests."),
    ("Gemini CLI", "gemini-cli", "Read the project first and use its existing server framework and file layout. If it has no server, add the smallest one that fits.",
     "Read it from the environment, add it to .env (and confirm .env is in .gitignore), and add a placeholder to .env.example.",
     "Add the key rule and the limits above to GEMINI.md, so later runs keep to them. Then run the app and tests."),
    ("Cline", "cline", "Read the project first and use its existing server framework and file layout. If it has no server, add the smallest one that fits. Show me the plan before you act.",
     "Read it from the environment, add it to .env (and confirm .env is in .gitignore), and add a placeholder to .env.example.",
     "Add the key rule and the limits above to .clinerules, so later tasks keep to them. Then run the app and tests."),
    ("Lovable", "lovable", "Build the server part as a backend function. The browser records or picks a file, then calls that function. For files too large for the function, upload to storage, make a signed link, and send the link to Saidwire as {\"url\": \"...\"}. Do not add live word-by-word streaming unless I ask: record, then transcribe, is the reliable pattern here.",
     "Ask me to add it through the app's secrets screen. Read it only inside the backend function.",
     "When it works, show me where the secret is set, and how to test with a 10-second recording."),
    ("Bolt", "bolt", "Check which stack this project uses. Put the Saidwire call in a server route or backend function, never in a client component. For files too large for that route, upload to storage, make a signed link, and send the link to Saidwire as {\"url\": \"...\"}. Do not add live word-by-word streaming unless I ask: it needs a long-running server.",
     "Ask me to add it as a server-only environment variable. Do not prefix it, and do not read it in client code.",
     "When it works, show me where the variable is set, and how to test with a 10-second recording."),
    ("bolt.diy", "bolt-diy", "Check which stack this project uses. Put the Saidwire call in a server route or backend function, never in a client component. Do not add live word-by-word streaming unless I ask: it needs a long-running server.",
     "Read it from a server-only environment variable, add a placeholder to .env.example, and confirm .env is not committed.",
     "When it works, show me how to test with a 10-second recording."),
    ("v0", "v0", "Use a Next.js route handler at app/api/transcribe/route.ts, and call it from a client component. Vercel Functions cap the request body at about 4.5 MB, so for longer recordings upload straight to storage from the browser, make a signed link, and send the link to Saidwire as {\"url\": \"...\"}. Use record-then-transcribe by default. If I ask for live words, tell me the options first: WebSocket support on Vercel Functions is in public beta, and the alternative is a small always-on server for the relay.",
     "Ask me to add it as a project environment variable. Read it only in the route handler.",
     "When it works, show me where the variable is set, and how to test with a 10-second recording."),
    ("Replit", "replit", "Use a small always-on server in this Repl (Node or Python, whichever the project uses). This host can run a WebSocket relay, so live words are fine if I ask for them.",
     "Ask me to add it in the Secrets tool. Read it from the environment.",
     "When it works, tell me which deployment type keeps the relay running, and how to test with a 10-second recording."),
    ("Base44", "base44", "Build the server part as a backend function. The browser records or picks a file, then calls that function. Do not add live word-by-word streaming: record, then transcribe.",
     "Ask me to add it through the app's secrets settings. Read it only inside the backend function.",
     "When it works, show me where the secret is set, and how to test with a 10-second recording."),
]


def prompt(tool, how, secret, finish):
    return "\n\n".join([ASK, "How to build it here\n" + how, RULES.format(secret=secret), FACTS.format(), "Finish\n" + finish])


index = ["# Copy-paste prompts", "", "Open your tool, paste the prompt, and replace the part in [brackets].", ""]
for name, slug, how, secret, finish in TOOLS:
    text = prompt(name, how, secret, finish)
    (HERE / f"{slug}.md").write_text(f"# Add Saidwire with {name}\n\nPaste this into {name}. Replace the part in [brackets].\n\n````text\n{text}\n````\n")
    index.append(f"- [{name}]({slug}.md)")
(HERE / "INDEX.md").write_text("\n".join(index) + "\n")
print(len(TOOLS), "prompts written")
