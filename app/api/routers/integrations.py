"""Integrations: the switch of the MCP server (app/mcp/). It takes effect on the
next request to /mcp; the backend is not restarted."""
from fastapi import APIRouter, Depends

from app.api.dependencies import get_app_settings
from app.api.schemas import McpSettings
from app.services.app_settings import AppSettings, MCP_ENABLED

router = APIRouter(prefix="/integrations", tags=["integrations"])


@router.get("/mcp", response_model=McpSettings)
def get_mcp(settings: AppSettings = Depends(get_app_settings)):
    return McpSettings(enabled=settings.get_bool(MCP_ENABLED))


@router.put("/mcp", response_model=McpSettings)
def set_mcp(body: McpSettings, settings: AppSettings = Depends(get_app_settings)):
    settings.set_bool(MCP_ENABLED, body.enabled)
    return McpSettings(enabled=settings.get_bool(MCP_ENABLED))
