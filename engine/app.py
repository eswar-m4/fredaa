from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from engine import handle_chat, health
from jobs import create_job, list_jobs

app = FastAPI(title="Ask Freda API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatIn(BaseModel):
    message: str = ""
    state: dict | None = None
    action: str | None = None
    history: list[dict] = Field(default_factory=list)


class NewSourceIn(BaseModel):
    title: str | None = None
    sourceUrl: str | None = None
    notes: str | None = None


@app.get("/health")
def get_health():
    return health()


@app.get("/catalog")
def get_catalog():
    info = health()["catalog"]
    return {
        "agentCount": info["agents"],
        "solutionCount": info["solutions"],
        "sourceCount": info["sources"],
    }


@app.post("/chat")
def post_chat(body: ChatIn):
    try:
        return handle_chat(body.message, body.state, body.action, body.history)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Ask Freda could not complete that turn: {exc}") from exc


@app.get("/jobs")
def get_jobs():
    return {"jobs": sorted(list_jobs(), key=lambda job: job.get("createdAt", ""), reverse=True)}


@app.post("/jobs")
def post_job(body: NewSourceIn):
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="A source name is required.")
    requirement = {
        "objective": f"Add new source: {title}",
        "entityType": "New source / Agent",
        "sources": [title],
        "sourceUrls": [body.sourceUrl] if body.sourceUrl else [],
        "attributes": [],
        "extras": {"notes": body.notes or ""},
    }
    job = create_job(
        {
            "title": f"New source: {title}",
            "requirement": requirement,
            "family": "generic",
            "estimate": {
                "volume": "To be scoped",
                "timeline": "Pending Solutions/Admin review for a new Agent.",
                "sources": [title],
                "attributes": [],
                "refresh": "To be confirmed",
                "geography": "Not specified",
                "assumptions": ["Source was submitted because it was not found in the current catalog."],
                "complexity": "Unknown",
            },
        }
    )
    return {"job": job}
