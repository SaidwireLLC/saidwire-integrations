# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [0.1.0] - 2026-10-31

### Added

- `SaidwireSTTService`: streaming speech-to-text over WebSocket, built on Pipecat's
  `WebsocketSTTService`. Interim and final transcripts, `Finalize` on
  `VADUserStoppedSpeakingFrame` (finals pushed with `finalized=True`), `KeepAlive` while
  idle, `CloseStream` on `EndFrame`, runtime settings via `STTUpdateSettingsFrame`.
- `on_early_word`, `on_speech_started` and `on_utterance_end` event handlers.
- Waits and retries while the service is starting up (HTTP 503 / 429 with `Retry-After`).
- Tested with Pipecat v1.15.0.
