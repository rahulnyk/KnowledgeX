#!/usr/bin/env bash
# Start the packaged extension server with the current Node and check it answers an MCP handshake.
set -euo pipefail
node --version
request='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"ci","version":"1"}}}'
reply=$(echo "$request" | KX_BUNDLE="${RUNNER_TEMP:-/tmp}/kx-smoke-notes" timeout 30 node build/mcpb/server/mcp.mjs)
echo "$reply" | grep -q '"serverInfo":{"name":"knowledgex"' || { echo "The extension did not answer the handshake: $reply"; exit 1; }
echo "The extension started and answered."
