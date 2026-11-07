# Container image for directories that inspect MCP servers (for example Glama).
# Normal users run `uvx saidwire-mcp` instead.
FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml README.md LICENSE ./
COPY src ./src
RUN pip install --no-cache-dir .
ENTRYPOINT ["saidwire-mcp"]
