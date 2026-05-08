from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.routes import router
from shared.config import get_settings


settings = get_settings()
app = FastAPI(title=settings.app_name, version="1.0.0")
app.include_router(router)

static_dir = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/", include_in_schema=False)
def home() -> FileResponse:
    return FileResponse(static_dir / "index.html")


@app.get("/portal", include_in_schema=False)
def portal() -> FileResponse:
    return FileResponse(static_dir / "index.html")


@app.get("/hugwand", include_in_schema=False)
def hugwand() -> FileResponse:
    return FileResponse(static_dir / "hugwand.html")


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok", "service": "backend"}
