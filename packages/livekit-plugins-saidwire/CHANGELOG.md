# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [0.1.0] - 2026-10-31

### Added

- `saidwire.STT`: streaming speech-to-text over WebSocket with interim and final
  transcripts, START/END_OF_SPEECH and usage events, and `recognize()` for pre-recorded
  audio.
- `manual_flush` support: the session's end-of-turn flush sends `Finalize`, which is
  answered right away with the final transcript.
- `early_word` events, `KeepAlive` while idle, `update_options()` with reconnect.
- Waits and retries while the service is starting up (HTTP 503 / 429 with `Retry-After`).
- Tested with livekit-agents 1.8.10.
