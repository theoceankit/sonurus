"""Who may call the backend from a page. The Vite dev server is allowed only when
npm run dev:ui asks for it, and never by a backend the packaged app started."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app.api.main import app, cors_origins

DEV_ORIGIN = "http://localhost:5173"
BASE_ORIGINS = ["null", "http://127.0.0.1", "http://localhost"]


def _preflight(target, origin):
    return TestClient(target).options(
        "/health",
        headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
    )


def test_default_origins_are_the_local_ones():
    assert cors_origins({}) == BASE_ORIGINS


def test_dev_origin_is_added_on_request():
    assert cors_origins({"SONORUS_DEV_UI_ORIGIN": DEV_ORIGIN}) == BASE_ORIGINS + [DEV_ORIGIN]


def test_packaged_backend_ignores_the_dev_origin():
    env = {"SONORUS_DEV_UI_ORIGIN": DEV_ORIGIN, "SONORUS_PACKAGED": "1"}
    assert cors_origins(env) == BASE_ORIGINS


def test_app_allows_file_pages_and_refuses_the_dev_server_by_default():
    assert _preflight(app, "null").status_code == 200
    assert _preflight(app, DEV_ORIGIN).status_code == 400


def test_requested_dev_origin_passes_the_preflight():
    target = FastAPI()
    target.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins({"SONORUS_DEV_UI_ORIGIN": DEV_ORIGIN}),
        allow_methods=["*"],
        allow_headers=["*"],
    )
    assert _preflight(target, DEV_ORIGIN).status_code == 200
