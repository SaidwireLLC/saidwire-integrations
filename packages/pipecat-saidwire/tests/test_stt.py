"""SaidwireSTTService against a fake server on 127.0.0.1 (tests/fake_saidwire.py).

No network calls leave the machine and no API key is needed.
"""

import pytest
from fake_saidwire import FakeSaidwire, silence_pcm, tone_pcm
from pipecat.frames.frames import (
    ErrorFrame,
    InputAudioRawFrame,
    InterimTranscriptionFrame,
    STTUpdateSettingsFrame,
    TranscriptionFrame,
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.pipeline.worker import PipelineParams
from pipecat.tests.utils import SleepFrame, run_test

from pipecat_saidwire import DEFAULT_MODEL, DEFAULT_URL, SaidwireSTTService

KEY = "sk_test_fake.secretsecretsecret"


def audio_frames(pcm: bytes, sr: int = 16000, ms: int = 20):
    n = sr * ms // 1000 * 2
    return [
        InputAudioRawFrame(audio=pcm[i : i + n], sample_rate=sr, num_channels=1)
        for i in range(0, len(pcm), n)
    ]


@pytest.fixture
async def server():
    s = await FakeSaidwire().start()
    yield s
    await s.stop()


def of_type(frames, cls):
    return [f for f in frames if type(f) is cls]


def errors(frames):
    return [f for f in frames if isinstance(f, ErrorFrame)]


async def test_interim_and_endpointed_final(server):
    stt = SaidwireSTTService(
        api_key=KEY, base_url=server.url, settings=SaidwireSTTService.Settings(endpointing=500)
    )
    pcm = tone_pcm(16000, 3) + silence_pcm(16000, 0.8)
    down, up = await run_test(
        stt, frames_to_send=[SleepFrame(0.2), *audio_frames(pcm), SleepFrame(0.5)]
    )
    finals = of_type(down, TranscriptionFrame)
    interims = of_type(down, InterimTranscriptionFrame)
    assert [f.text for f in finals] == ["Hello this is"]
    assert [f.text for f in interims] == ["Hello", "Hello this", "Hello this is"]
    assert finals[0].result["speech_final"] is True
    q = server.conns[0].query
    assert q["encoding"] == "linear16" and q["sample_rate"] == "16000" and q["channels"] == "1"
    assert q["endpointing"] == "500" and q["model"] == DEFAULT_MODEL
    assert q["interim_results"] == "true" and q["punctuate"] == "true" and q["language"] == "en"
    assert server.conns[0].auth == KEY
    assert not errors(up)


async def test_default_query_matches_documented_defaults(server):
    stt = SaidwireSTTService(api_key=KEY, base_url=server.url)
    await run_test(stt, frames_to_send=[SleepFrame(0.2)])
    q = server.conns[0].query
    assert "endpointing" not in q  # server default
    assert "early_words" not in q and "vad_events" not in q and "utterance_end_ms" not in q
    assert DEFAULT_URL == "wss://api.saidwire.com/v1/listen"


async def test_https_base_url_is_converted_to_wss():
    stt = SaidwireSTTService(api_key=KEY, base_url="https://api.saidwire.com/v1/listen")
    assert stt._base_url == "wss://api.saidwire.com/v1/listen"


async def test_vad_stop_sends_finalize_and_final_is_marked_finalized(server):
    stt = SaidwireSTTService(
        api_key=KEY, base_url=server.url, settings=SaidwireSTTService.Settings(endpointing=False)
    )
    pcm = tone_pcm(16000, 2) + silence_pcm(16000, 0.2)
    frames = [
        SleepFrame(0.2),
        VADUserStartedSpeakingFrame(),
        *audio_frames(pcm),
        SleepFrame(0.2),
        VADUserStoppedSpeakingFrame(stop_secs=0.2),
        SleepFrame(0.4),
    ]
    down, _ = await run_test(stt, frames_to_send=frames)
    finals = of_type(down, TranscriptionFrame)
    assert [f.text for f in finals] == ["Hello this"]
    assert finals[0].finalized is True
    assert finals[0].result["from_finalize"] is True
    assert server.conns[0].query["endpointing"] == "false"
    assert {"type": "Finalize"} in server.conns[0].texts
    assert server.conns[0].texts[-1] == {"type": "CloseStream"}  # EndFrame closes politely


async def test_vad_force_finalize_off_sends_no_finalize(server):
    stt = SaidwireSTTService(api_key=KEY, base_url=server.url, vad_force_finalize=False)
    frames = [SleepFrame(0.2), VADUserStoppedSpeakingFrame(stop_secs=0.2), SleepFrame(0.2)]
    await run_test(stt, frames_to_send=frames)
    assert {"type": "Finalize"} not in server.conns[0].texts


async def test_empty_finalize_answer_pushes_nothing(server):
    stt = SaidwireSTTService(api_key=KEY, base_url=server.url)
    frames = [
        SleepFrame(0.2),
        *audio_frames(silence_pcm(16000, 0.3)),
        SleepFrame(0.1),
        VADUserStoppedSpeakingFrame(stop_secs=0.2),
        SleepFrame(0.3),
    ]
    down, up = await run_test(stt, frames_to_send=frames)
    assert of_type(down, TranscriptionFrame) == []
    assert any(m.get("from_finalize") for m in server.conns[0].sent)
    assert not errors(up)


async def test_early_words_speech_started_utterance_end_events(server):
    stt = SaidwireSTTService(
        api_key=KEY,
        base_url=server.url,
        settings=SaidwireSTTService.Settings(
            early_words=True,
            vad_events=True,
            utterance_end_ms=1000,
            endpointing=500,
            interim_results=False,
        ),
    )
    early, started, ended = [], [], []

    @stt.event_handler("on_early_word")
    async def _ew(_s, w):
        early.append(w["word"])

    @stt.event_handler("on_speech_started")
    async def _ss(_s, m):
        started.append(m["timestamp"])

    @stt.event_handler("on_utterance_end")
    async def _ue(_s, m):
        ended.append(m["last_word_end"])

    pcm = tone_pcm(16000, 4) + silence_pcm(16000, 1.3)
    down, _ = await run_test(
        stt, frames_to_send=[SleepFrame(0.2), *audio_frames(pcm), SleepFrame(0.5)]
    )
    assert early == ["hello", "this", "is", "a"]
    assert started == [0.2]
    assert len(ended) == 1
    assert of_type(down, InterimTranscriptionFrame) == []  # interim_results=False
    assert [f.text for f in of_type(down, TranscriptionFrame)] == ["Hello this is a"]
    q = server.conns[0].query
    assert q["early_words"] == "true" and q["vad_events"] == "true"
    assert q["utterance_end_ms"] == "1000" and q["interim_results"] == "false"


async def test_bad_key_is_permanent_and_not_retried():
    s = await FakeSaidwire().start()
    try:
        stt = SaidwireSTTService(
            api_key="sk_live_wrong.key",
            base_url=s.url,
            reconnect_backoff_min_wait=0.1,
            reconnect_backoff_max_wait=0.2,
        )
        down, up = await run_test(
            stt,
            frames_to_send=[SleepFrame(0.5), *audio_frames(tone_pcm(16000, 1)), SleepFrame(0.5)],
        )
        errs = errors(up)
        assert errs and "INVALID_AUTH" in errs[0].error and "401" in errs[0].error
        assert s.handshakes == 1
        assert of_type(down, TranscriptionFrame) == []
    finally:
        await s.stop()


async def test_waits_while_service_is_starting_up():
    s = await FakeSaidwire(warming_refusals=2, retry_after_s=1).start()
    try:
        stt = SaidwireSTTService(
            api_key=KEY, base_url=s.url, settings=SaidwireSTTService.Settings(endpointing=500)
        )
        pcm = tone_pcm(16000, 2) + silence_pcm(16000, 0.8)
        down, up = await run_test(
            stt, frames_to_send=[SleepFrame(2.5), *audio_frames(pcm), SleepFrame(0.5)]
        )
        assert s.handshakes == 3 and len(s.conns) == 1
        assert [f.text for f in of_type(down, TranscriptionFrame)] == ["Hello this"]
        assert not errors(up)
    finally:
        await s.stop()


async def test_gives_up_after_warmup_timeout():
    s = await FakeSaidwire(warming_refusals=100, retry_after_s=1).start()
    try:
        stt = SaidwireSTTService(api_key=KEY, base_url=s.url, warmup_timeout=1.5)
        _, up = await run_test(stt, frames_to_send=[SleepFrame(2.5)])
        errs = errors(up)
        assert errs and "not ready" in errs[-1].error
        assert s.handshakes == 2
    finally:
        await s.stop()


async def test_midstream_server_error_reconnects_and_keeps_transcribing():
    s = await FakeSaidwire(
        error_after_s=0.3,
        error_code="ENGINE_UNAVAILABLE",
        error_close=1011,
        error_on_first_n_streams=1,
    ).start()
    try:
        stt = SaidwireSTTService(
            api_key=KEY,
            base_url=s.url,
            reconnect_backoff_min_wait=0.1,
            reconnect_backoff_max_wait=0.2,
            settings=SaidwireSTTService.Settings(endpointing=500),
        )
        pcm = tone_pcm(16000, 2) + silence_pcm(16000, 0.8)
        down, up = await run_test(
            stt, frames_to_send=[SleepFrame(1.2), *audio_frames(pcm), SleepFrame(0.5)]
        )
        assert len(s.conns) == 2 and s.conns[0].close_code == 1011
        assert [f.text for f in of_type(down, TranscriptionFrame)] == ["Hello this"]
        assert any("ENGINE_UNAVAILABLE" in f.error for f in errors(up))
    finally:
        await s.stop()


async def test_keepalive_holds_idle_stream_open():
    s = await FakeSaidwire(idle_timeout_s=4.5).start()
    try:
        stt = SaidwireSTTService(api_key=KEY, base_url=s.url)
        await run_test(stt, frames_to_send=[SleepFrame(6.5)])
        c = s.conns[0]
        assert {"type": "KeepAlive"} in c.texts
        assert c.close_code == 1000  # closed by our CloseStream, not IDLE_TIMEOUT
        assert c.audio_bytes == 0  # KeepAlive, not billed silence
        assert len(s.conns) == 1
    finally:
        await s.stop()


async def test_settings_update_reconnects_with_new_query(server):
    stt = SaidwireSTTService(api_key=KEY, base_url=server.url)
    frames = [
        SleepFrame(0.2),
        STTUpdateSettingsFrame(delta=SaidwireSTTService.Settings(endpointing=650)),
        SleepFrame(0.3),
        *audio_frames(tone_pcm(16000, 1) + silence_pcm(16000, 0.9)),
        SleepFrame(0.4),
    ]
    down, _ = await run_test(stt, frames_to_send=frames)
    assert len(server.conns) == 2
    assert "endpointing" not in server.conns[0].query
    assert server.conns[1].query["endpointing"] == "650"
    assert [f.text for f in of_type(down, TranscriptionFrame)] == ["Hello"]


async def test_8khz_pipeline(server):
    stt = SaidwireSTTService(
        api_key=KEY, base_url=server.url, settings=SaidwireSTTService.Settings(endpointing=500)
    )
    pcm = tone_pcm(8000, 2) + silence_pcm(8000, 0.8)
    down, _ = await run_test(
        stt,
        pipeline_params=PipelineParams(audio_in_sample_rate=8000),
        frames_to_send=[SleepFrame(0.2), *audio_frames(pcm, sr=8000), SleepFrame(0.4)],
    )
    assert server.conns[0].query["sample_rate"] == "8000"
    assert [f.text for f in of_type(down, TranscriptionFrame)] == ["Hello this"]


def test_api_key_required(monkeypatch):
    monkeypatch.delenv("SAIDWIRE_API_KEY", raising=False)
    with pytest.raises(ValueError):
        SaidwireSTTService()


def test_api_key_from_env(monkeypatch):
    monkeypatch.setenv("SAIDWIRE_API_KEY", KEY)
    assert SaidwireSTTService()._api_key == KEY
