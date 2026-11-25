"""The MCP endpoint at /mcp: Streamable HTTP without sessions, answered with
JSON. It answers only while the switch in Settings → Integrations is on
(app_settings); otherwise /mcp is not found, as if it did not exist."""
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator, Callable

from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from starlette.responses import JSONResponse
from starlette.types import Receive, Scope, Send

from app.mcp.note_tools import register_note_tools
from app.mcp.read_tools import register_read_tools
from app.services.search_service import SearchService
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService
from app.version import get_version

INSTRUCTIONS = (
    "Sonorus keeps the user's transcribed recordings on this machine. "
    "Recordings are named by recording_id; times in a recording are mm:ss or h:mm:ss."
)

# Only this machine's own names: a page of another site (Origin) or a name that
# only resolves to 127.0.0.1 (Host, DNS rebinding) is refused.
SECURITY = TransportSecuritySettings(
    enable_dns_rebinding_protection=True,
    allowed_hosts=["127.0.0.1:*", "localhost:*", "[::1]:*"],
    allowed_origins=["http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*"],
)


def build_server(storage: Callable[[], TranscriptStorageService],
                 memory: Callable[[], SpeakerMemoryService],
                 search: Callable[[], SearchService] | None = None) -> MCPServer:
    """The server and its tools; storage, memory and search give the services
    each call uses. search: by default one over storage and memory, as GET /search."""
    server = MCPServer("Sonorus", instructions=INSTRUCTIONS, version=get_version())
    register_read_tools(server, storage, memory, search or (lambda: SearchService(storage(), memory())))
    register_note_tools(server, storage, memory)
    return server


class McpEndpoint:
    """The ASGI app of /mcp. running() is entered by the app lifespan: the SDK
    runs requests in a task group that lives as long as it does."""

    def __init__(self, server: MCPServer, enabled: Callable[[], bool]):
        self.server = server
        self.enabled = enabled
        self._manager = None

    @asynccontextmanager
    async def running(self) -> AsyncIterator[None]:
        # A session manager runs once: each lifespan gets a new one.
        self.server.streamable_http_app(stateless_http=True, json_response=True, transport_security=SECURITY)
        manager = self.server.session_manager
        async with manager.run():
            self._manager = manager
            try:
                yield
            finally:
                self._manager = None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not self.enabled() or self._manager is None:
            await JSONResponse({"detail": "Not Found"}, status_code=404)(scope, receive, send)
            return
        await self._manager.handle_request(scope, receive, send)
