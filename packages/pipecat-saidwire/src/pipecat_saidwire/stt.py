#
# Copyright (c) 2026, Saidwire
#
# SPDX-License-Identifier: MIT
#

"""Saidwire real-time speech-to-text service for Pipecat.

Streams 16-bit PCM to ``wss://api.saidwire.com/v1/listen`` and turns the replies into
Pipecat frames:

* interim results -> ``InterimTranscriptionFrame``
* final results -> ``TranscriptionFrame``
* ``VADUserStoppedSpeakingFrame`` -> a ``Finalize`` message, answered right away with the
  final transcript (pushed with ``finalized=True``)

Extras with no Pipecat frame are exposed as event handlers: ``on_early_word`` (each word as
soon as it is committed, with ``early_words=True``), ``on_speech_started``
(``vad_events=True``) and ``on_utterance_end`` (``utterance_end_ms`` set).
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import urllib.parse
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from typing import Any

from loguru import logger
from pipecat.frames.frames import (
    EndFrame,
    Frame,
    InterimTranscriptionFrame,
    TranscriptionFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessorSetup
from pipecat.services.settings import STTSettings
from pipecat.services.stt_service import WebsocketSTTService
from pipecat.transcriptions.language import Language
from pipecat.utils.time import time_now_iso8601
from pipecat.utils.tracing.service_decorators import traced_stt
from pipecat.utils.types import NOT_GIVEN, NotGiven
from websockets.exceptions import InvalidStatus
from websockets.protocol import State

from .version import __version__

DEFAULT_URL = "wss://api.saidwire.com/v1/listen"
DEFAULT_MODEL = "saidwire-en-2026-10-30"

# Speech end -> final transcript, P99, in seconds, broadcast to Pipecat turn strategies. A
# conservative default that includes network time from wherever your bot runs: measure your
# own deployment and pass ``ttfs_p99_latency=`` to override.
SAIDWIRE_TTFS_P99: float = 0.30

# Error codes after which retrying cannot help.
_PERMANENT_ERRORS = {
    "INVALID_AUTH",
    "KEY_REVOKED",
    "FORBIDDEN",
    "PAYMENT_REQUIRED",
    "QUOTA_EXCEEDED",
    "BAD_REQUEST",
    "UNSUPPORTED_AUDIO",
    "UNSUPPORTED_LANGUAGE",
}
_PERMANENT_HTTP = {400, 401, 402, 403, 404}
# Refusals that mean "not now": the service is starting up, busy or rate limited.
_WAIT_HTTP = {429, 503}

_KEEPALIVE = json.dumps({"type": "KeepAlive"})
_FINALIZE = json.dumps({"type": "Finalize"})
_CLOSE_STREAM = json.dumps({"type": "CloseStream"})


@dataclass
class SaidwireSTTSettings(STTSettings):
    """Runtime-updatable settings for :class:`SaidwireSTTService`.

    ``model`` and ``language`` are inherited from ``STTSettings``. Changing any setting
    reconnects the stream between user turns.

    Parameters:
        endpointing: Milliseconds of pause that end an utterance on the server, or
            ``False`` to let your own VAD / turn detector decide (finals then come on
            ``Finalize`` and at longer pauses). ``None`` uses the server default.
        utterance_end_ms: Send an ``UtteranceEnd`` message after this much silence
            (100-10000). ``None`` turns it off.
        interim_results: Send interim transcripts while the user is speaking.
        punctuate: Punctuation and capitals in transcripts.
        early_words: Fire ``on_early_word`` for each word as soon as it is committed.
        vad_events: Fire ``on_speech_started`` when the server hears speech begin.
    """

    endpointing: int | bool | None | NotGiven = field(default_factory=lambda: NOT_GIVEN)
    utterance_end_ms: int | None | NotGiven = field(default_factory=lambda: NOT_GIVEN)
    interim_results: bool | NotGiven = field(default_factory=lambda: NOT_GIVEN)
    punctuate: bool | NotGiven = field(default_factory=lambda: NOT_GIVEN)
    early_words: bool | NotGiven = field(default_factory=lambda: NOT_GIVEN)
    vad_events: bool | NotGiven = field(default_factory=lambda: NOT_GIVEN)


def _query_value(v: Any) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)


def _ws_url(url: str) -> str:
    if url.startswith("https://"):
        return "wss://" + url[len("https://") :]
    if url.startswith("http://"):
        return "ws://" + url[len("http://") :]
    return url


def _retry_after(headers: Any, default: float = 5.0) -> float:
    try:
        return max(1.0, min(30.0, float(headers.get("Retry-After"))))
    except (TypeError, ValueError):
        return default


class SaidwireSTTService(WebsocketSTTService):
    """Saidwire streaming speech-to-text (English).

    Example::

        stt = SaidwireSTTService(api_key=os.getenv("SAIDWIRE_API_KEY"))

    Event handlers, in addition to ``on_connected``, ``on_disconnected`` and
    ``on_connection_error``::

        @stt.event_handler("on_early_word")
        async def on_early_word(stt, word: dict):  # {"word", "punctuated_word", "start", ...}
            ...
    """

    Settings = SaidwireSTTSettings
    _settings: Settings

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str = DEFAULT_URL,
        sample_rate: int | None = None,
        settings: Settings | None = None,
        vad_force_finalize: bool = True,
        warmup_timeout: float = 300.0,
        ttfs_p99_latency: float | None = SAIDWIRE_TTFS_P99,
        **kwargs,
    ):
        """Initialize the Saidwire STT service.

        Args:
            api_key: Saidwire API key. Defaults to the ``SAIDWIRE_API_KEY`` environment
                variable.
            base_url: Streaming endpoint. Defaults to ``wss://api.saidwire.com/v1/listen``.
                ``https://`` URLs are converted to ``wss://``.
            sample_rate: Input sample rate (8000-48000). ``None`` uses the pipeline's input
                rate.
            settings: Runtime-updatable settings (see :class:`SaidwireSTTSettings`).
            vad_force_finalize: When True (default), a ``VADUserStoppedSpeakingFrame`` sends
                ``Finalize``, which the server answers immediately with the final transcript
                of everything heard so far. This is the lowest-latency mode for voice agents.
            warmup_timeout: How long, in seconds, to keep retrying while the service answers
                "starting up" or "busy" (HTTP 503 / 429) before reporting a permanent error.
                Audio sent while waiting is not transcribed.
            ttfs_p99_latency: P99 speech-end to final-transcript latency in seconds,
                broadcast to Pipecat turn strategies.
            **kwargs: Passed to :class:`WebsocketSTTService` / ``STTService``.
        """
        default_settings = self.Settings(
            model=DEFAULT_MODEL,
            language="en",
            endpointing=None,
            utterance_end_ms=None,
            interim_results=True,
            punctuate=True,
            early_words=False,
            vad_events=False,
        )
        if settings is not None:
            default_settings.apply_update(settings)

        super().__init__(
            sample_rate=sample_rate,
            ttfs_p99_latency=ttfs_p99_latency,
            # The server closes a stream after 10 s with no audio and no KeepAlive. Pipelines
            # normally stream audio all the time; this covers muted or switched-out services.
            keepalive_timeout=3.0,
            keepalive_interval=2.0,
            settings=default_settings,
            **kwargs,
        )

        self._api_key = api_key or os.environ.get("SAIDWIRE_API_KEY", "")
        if not self._api_key:
            raise ValueError("Saidwire API key is required: pass api_key= or set SAIDWIRE_API_KEY")
        self._base_url = _ws_url(base_url)
        self._vad_force_finalize = vad_force_finalize
        self._warmup_timeout = warmup_timeout
        self._receive_task: asyncio.Task | None = None
        self._warmup_task: asyncio.Task | None = None
        self._retry_after: float | None = None
        self._request_id: str | None = None

        self._register_event_handler("on_early_word")
        self._register_event_handler("on_speech_started")
        self._register_event_handler("on_utterance_end")

    def can_generate_metrics(self) -> bool:
        """Check if this service can generate processing metrics.

        Returns:
            True: the service reports TTFB (speech end to final) and usage metrics.
        """
        return True

    @property
    def request_id(self) -> str | None:
        """The ``request_id`` of the current stream (quote it when contacting support)."""
        return self._request_id

    def language_to_service_language(self, language: Language) -> str | None:
        """Map a Pipecat language to the API's ``language`` parameter.

        Args:
            language: The Pipecat language.

        Returns:
            The language code sent to the API. The API is English-only.
        """
        value = str(language.value if isinstance(language, Language) else language)
        if not value.lower().startswith("en"):
            logger.warning(f"{self}: Saidwire is English-only; '{value}' will be refused")
        return value

    def build_url(self) -> str:
        """Build the streaming URL for the current settings.

        Returns:
            The WebSocket URL with query parameters.
        """
        s = self._settings
        q: dict[str, str] = {
            "encoding": "linear16",
            "sample_rate": str(self.sample_rate),
            "channels": "1",
            "interim_results": _query_value(bool(s.interim_results)),
            "punctuate": _query_value(bool(s.punctuate)),
        }
        if s.model:
            q["model"] = str(s.model)
        if s.language:
            q["language"] = str(s.language)
        if s.endpointing is not None and s.endpointing is not True:
            q["endpointing"] = _query_value(s.endpointing)
        if s.utterance_end_ms:
            q["utterance_end_ms"] = str(int(s.utterance_end_ms))
        if s.early_words:
            q["early_words"] = "true"
        if s.vad_events:
            q["vad_events"] = "true"
        sep = "&" if "?" in self._base_url else "?"
        return f"{self._base_url}{sep}{urllib.parse.urlencode(q)}"

    async def _update_settings(self, delta: Settings) -> dict[str, Any]:
        """Apply a settings delta and reconnect if anything changed."""
        changed = await super()._update_settings(delta)
        if changed:
            await self._request_reconnect()
        return changed

    async def setup(self, setup: FrameProcessorSetup):
        """Set up the service and open the stream.

        Args:
            setup: Configuration object containing setup parameters.
        """
        await super().setup(setup)
        await self._connect()

    async def stop(self, frame: EndFrame):
        """Stop on a graceful end: tell the server the stream is over, then close.

        Args:
            frame: The end frame.
        """
        await self._send_text(_CLOSE_STREAM)
        await super().stop(frame)

    async def _connect(self):
        await super()._connect()
        await self._connect_websocket()
        if self._websocket is None and self._retry_after is not None:
            if not self._warmup_task:
                self._warmup_task = self.create_task(self._warmup_handler())
        else:
            self._start_receiving()

    def _start_receiving(self):
        # Also started after a failed first connect: the receive loop then takes its
        # reconnect-with-backoff path. A permanent refusal leaves the service unusable.
        if not self._receive_task and self.is_usable:
            self._receive_task = self.create_task(self._receive_task_handler(self._report_error))

    async def _disconnect(self):
        await super()._disconnect()
        if self._warmup_task:
            await self.cancel_task(self._warmup_task)
            self._warmup_task = None
        if self._receive_task:
            await self.cancel_task(self._receive_task)
            self._receive_task = None
        await self._disconnect_websocket()

    async def _warmup_handler(self):
        """Retry the handshake while the service is starting up, then start receiving."""
        deadline = time.monotonic() + self._warmup_timeout
        try:
            while self._retry_after is not None and self._websocket is None:
                wait = self._retry_after
                if time.monotonic() + wait > deadline:
                    await self.push_error(
                        error_msg=f"Saidwire was not ready after {self._warmup_timeout:.0f} s",
                        force_treat_as_permanent=True,
                    )
                    return
                logger.info(f"{self}: Saidwire is starting up, retrying in {wait:.0f} s")
                await asyncio.sleep(wait)
                await self._connect_websocket()
            self._start_receiving()
        finally:
            self._warmup_task = None

    async def _connect_websocket(self):
        self._retry_after = None
        try:
            if self._websocket and self._websocket.state is State.OPEN:
                return
            logger.debug(f"{self}: connecting to {self._base_url}")
            self._websocket = await self._websocket_connect(
                self.build_url(),
                additional_headers={"Authorization": f"Token {self._api_key}"},
                user_agent_header=f"pipecat-saidwire/{__version__}",
            )
            response = getattr(self._websocket, "response", None)
            if response is not None:
                self._request_id = response.headers.get("x-request-id")
            await self._call_event_handler("on_connected")
            logger.debug(f"{self}: connected (request_id={self._request_id})")
        except InvalidStatus as e:
            self._websocket = None
            status = e.response.status_code
            code, msg = _parse_error_body(e.response.body)
            if status in _WAIT_HTTP:
                self._retry_after = _retry_after(e.response.headers)
                logger.warning(f"{self}: Saidwire answered HTTP {status} {code or ''} {msg or ''}")
                return
            permanent = status in _PERMANENT_HTTP or code in _PERMANENT_ERRORS
            await self.push_error(
                error_msg=f"Saidwire refused the stream: HTTP {status} {code or ''} {msg or ''}".strip(),
                exception=e,
                force_treat_as_permanent=permanent,
            )
        except Exception as e:
            self._websocket = None
            await self.push_error(error_msg=f"Unable to connect to Saidwire: {e}", exception=e)

    async def _disconnect_websocket(self):
        try:
            if self._websocket:
                await self._websocket.close()
        except Exception as e:
            logger.warning(f"{self}: error closing websocket: {e}")
        finally:
            self._websocket = None
            await self._call_event_handler("on_disconnected")

    def _get_websocket(self):
        if self._websocket:
            return self._websocket
        raise ConnectionError("Saidwire websocket not connected")

    async def _send_text(self, text: str) -> bool:
        if self._websocket and self._websocket.state is State.OPEN:
            try:
                await self._websocket.send(text)
                return True
            except Exception as e:
                logger.warning(f"{self}: send failed: {e}")
        return False

    async def _send_keepalive(self, silence: bytes):
        """Send the protocol KeepAlive message instead of silence (silence is billed audio)."""
        await self._send_text(_KEEPALIVE)

    async def run_stt(self, audio: bytes) -> AsyncGenerator[Frame | None, None]:
        """Send audio to Saidwire; transcripts arrive on the receive task.

        Args:
            audio: Raw 16-bit PCM audio.

        Yields:
            None: transcription frames are pushed from the receive task.
        """
        if self._websocket and self._websocket.state is State.OPEN:
            try:
                await self._websocket.send(audio)
            except Exception as e:
                logger.warning(f"{self}: audio send failed: {e}")
        yield None

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        """Process frames, sending ``Finalize`` when the local VAD says the user stopped.

        Args:
            frame: The frame to process.
            direction: The direction of frame processing.
        """
        await super().process_frame(frame, direction)
        if isinstance(frame, VADUserStoppedSpeakingFrame) and self._vad_force_finalize:
            if self._websocket and self._websocket.state is State.OPEN:
                self.request_finalize()
                await self._send_text(_FINALIZE)

    @traced_stt
    async def _handle_transcription(
        self, transcript: str, is_final: bool, language: Language | None = None
    ):
        """Handle a transcription result with tracing."""
        pass

    async def _receive_messages(self):
        async for message in self._get_websocket():
            if isinstance(message, bytes):
                continue
            try:
                data = json.loads(message)
            except json.JSONDecodeError:
                logger.warning(f"{self}: non-JSON message ignored")
                continue
            try:
                await self._on_message(data)
            except Exception as e:  # never let one bad message end the stream
                logger.warning(f"{self}: error handling {data.get('type')}: {e}")

    async def _on_message(self, data: dict):
        typ = data.get("type")
        if typ == "Results":
            await self._on_results(data)
        elif typ == "EarlyWord":
            await self._call_event_handler("on_early_word", data)
        elif typ == "SpeechStarted":
            await self._call_event_handler("on_speech_started", data)
        elif typ == "UtteranceEnd":
            await self._call_event_handler("on_utterance_end", data)
        elif typ == "Error":
            code = data.get("err_code", "")
            msg = (
                f"Saidwire error {code}: {data.get('err_msg', '')} "
                f"(request_id={data.get('request_id')})"
            )
            if code == "BAD_MESSAGE":
                logger.warning(msg)
            else:
                await self.push_error(
                    error_msg=msg, force_treat_as_permanent=code in _PERMANENT_ERRORS
                )
        # Metadata: nothing to do.

    def _language(self) -> Language | None:
        language = self._settings.language
        if isinstance(language, str) and language in Language._value2member_map_:
            return Language(language)
        return None

    async def _on_results(self, data: dict):
        alts = (data.get("channel") or {}).get("alternatives") or []
        transcript = (alts[0].get("transcript") or "").strip() if alts else ""
        lang = self._language()

        if data.get("is_final"):
            from_finalize = bool(data.get("from_finalize"))
            if from_finalize:
                self.confirm_finalize()
            if transcript:
                await self.emit_stt_usage_metrics()
                await self.push_frame(
                    TranscriptionFrame(
                        transcript, self._user_id, time_now_iso8601(), lang, result=data
                    )
                )
                await self._handle_transcription(transcript, True, lang)
            elif from_finalize:
                # Everything was already delivered in earlier finals: report TTFB now
                # instead of waiting for the timeout.
                self._finalize_pending = False
                await self.stop_ttfb_metrics()
                await self._cancel_ttfb_timeout()
        elif transcript:
            await self.push_frame(
                InterimTranscriptionFrame(
                    transcript, self._user_id, time_now_iso8601(), lang, result=data
                )
            )


def _parse_error_body(body: bytes | bytearray | None) -> tuple[str | None, str | None]:
    if not body:
        return None, None
    try:
        d = json.loads(body)
        return d.get("err_code"), d.get("err_msg")
    except Exception:
        return None, body[:200].decode("utf-8", "replace")
