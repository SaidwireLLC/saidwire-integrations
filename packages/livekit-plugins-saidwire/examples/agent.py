"""A LiveKit voice agent that hears the user through Saidwire.

    pip install "livekit-agents[silero]" livekit-plugins-saidwire python-dotenv
    export SAIDWIRE_API_KEY=...
    export LIVEKIT_URL=... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=...
    export LIVEKIT_LLM_MODEL=... LIVEKIT_TTS_MODEL=... LIVEKIT_TTS_VOICE=...
    python agent.py console          # talk to it from your terminal
    python agent.py dev              # or join it from a LiveKit room

The LLM and TTS here go through LiveKit Inference, so only LiveKit credentials are needed
for them. The only Saidwire-specific line is ``stt=saidwire.STT()``.
"""

import logging
import os

from dotenv import load_dotenv

from livekit.agents import Agent, AgentServer, AgentSession, JobContext, cli, inference
from livekit.plugins import saidwire, silero

logger = logging.getLogger("saidwire-agent")

load_dotenv()


class Assistant(Agent):
    def __init__(self) -> None:
        super().__init__(
            instructions=(
                "You are a helpful voice assistant. Your replies are spoken aloud, so keep "
                "them short and do not use emojis, markdown or other special characters."
            ),
        )

    async def on_enter(self) -> None:
        self.session.generate_reply(instructions="greet the user briefly")


server = AgentServer()


@server.rtc_session()
async def entrypoint(ctx: JobContext) -> None:
    session = AgentSession(
        # Saidwire speech-to-text. When the VAD ends the user's turn, the session flushes the
        # stream and the final transcript comes straight back.
        stt=saidwire.STT(),
        vad=silero.VAD.load(),
        llm=inference.LLM(os.environ["LIVEKIT_LLM_MODEL"]),
        tts=inference.TTS(os.environ["LIVEKIT_TTS_MODEL"], voice=os.environ["LIVEKIT_TTS_VOICE"]),
    )
    await session.start(agent=Assistant(), room=ctx.room)


if __name__ == "__main__":
    cli.run_app(server)
