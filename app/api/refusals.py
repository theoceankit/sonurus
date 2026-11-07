"""Refusals the UI acts on: a message for the user, without paths, and a code
for what the UI does about it. The body keeps FastAPI's string `detail`, so a
client that reads only the message sees no change."""
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from app.api.schemas import RefusalCode


class Refusal(HTTPException):
    def __init__(self, code: RefusalCode, message: str, status_code: int = 400):
        super().__init__(status_code=status_code, detail=message)
        self.code = code


async def refusal_handler(_: Request, exc: Refusal) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail, "code": exc.code})
