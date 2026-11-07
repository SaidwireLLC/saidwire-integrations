#
# Copyright (c) 2026, Saidwire
#
# SPDX-License-Identifier: MIT
#

"""Stream a WAV file through Saidwire in a Pipecat pipeline and print the transcripts.

    pip install pipecat-saidwire
    export SAIDWIRE_API_KEY=...
    python transcribe_file.py call.wav          # 16-bit mono WAV, 8-48 kHz

Audio is sent in real time (20 ms frames), the way a transport delivers it. At the end of
the file a VADUserStoppedSpeakingFrame stands in for your VAD: it sends Finalize, which
returns the final transcript right away. No LLM or TTS keys are needed.
"""

import argparse
import asyncio
import time
import wave

from pipecat.frames.frames import (
    EndFrame,
    Frame,
    InputAudioRawFrame,
    InterimTranscriptionFrame,
    TranscriptionFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.workers.runner import WorkerRunner

from pipecat_saidwire import DEFAULT_URL, SaidwireSTTService


class TranscriptPrinter(FrameProcessor):
    def __init__(self):
        super().__init__()
        self.audio_done_at: float | None = None

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, TranscriptionFrame):
            tail = ""
            if self.audio_done_at is not None:
                ms = (time.perf_counter() - self.audio_done_at) * 1000
                tail = f"   ({ms:.0f} ms after the last audio frame)"
            print(f"final   : {frame.text}{tail}", flush=True)
        elif isinstance(frame, InterimTranscriptionFrame):
            print(f"interim : {frame.text}", flush=True)
        await self.push_frame(frame, direction)


async def main(path: str, url: str):
    with wave.open(path) as w:
        if w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise SystemExit("need a 16-bit mono WAV")
        sr, pcm = w.getframerate(), w.readframes(w.getnframes())

    stt = SaidwireSTTService(base_url=url)  # api_key from SAIDWIRE_API_KEY
    printer = TranscriptPrinter()
    worker = PipelineWorker(
        Pipeline([stt, printer]), params=PipelineParams(audio_in_sample_rate=sr)
    )
    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)

    async def feed():
        await asyncio.sleep(1.0)  # let the stream connect
        step = sr // 50 * 2  # 20 ms of 16-bit samples
        t0 = time.perf_counter()
        for i, off in enumerate(range(0, len(pcm), step)):
            frame = InputAudioRawFrame(audio=pcm[off : off + step], sample_rate=sr, num_channels=1)
            await worker.queue_frame(frame)
            await asyncio.sleep(max(0.0, t0 + (i + 1) * 0.02 - time.perf_counter()))
        printer.audio_done_at = time.perf_counter()
        await worker.queue_frame(VADUserStoppedSpeakingFrame())
        await asyncio.sleep(1.5)
        await worker.queue_frame(EndFrame())

    await asyncio.gather(runner.run(), feed())


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("wav")
    ap.add_argument("--url", default=DEFAULT_URL)
    a = ap.parse_args()
    asyncio.run(main(a.wav, a.url))
