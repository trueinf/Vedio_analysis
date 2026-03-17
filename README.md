## AI Video Performance Analyzer

Upload (or import) a long video (up to ~3 hours) and get delivery metrics:

- **Speech Rate** (WPM)
- **Tonal Variation** (prosody summary)
- **Filler Words** (types + frequency)
- **Eye Contact Ratio** (camera vs away)
- **Expression Change** (expressions + change rate)
- **Gesture Frequency** (gestures/min + types)

This repo contains:

- `backend/`: FastAPI API + Redis/RQ worker pipeline for analysis
- `frontend/`: Next.js dashboard UI (matches the provided reference)

### Prerequisites

- **Python 3.11+**
- **Node 18+**
- **FFmpeg** available on PATH (`ffmpeg -version`)
- Optional (recommended): **Docker Desktop** for running Redis via Compose

### Quick start (local)

1) Start Redis (Docker):

```bash
docker compose up -d redis
```

2) Backend (API + worker):

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt

uvicorn app.main:app --reload
```

In another terminal:

```bash
cd backend
.\.venv\Scripts\activate
python -m app.worker
```

3) Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open the app at `http://localhost:3000`.

### Notes on multi-speaker diarization

Multi-speaker attribution is implemented with an **optional** diarization module.
If you provide a HuggingFace token via `HF_TOKEN`, diarization will be enabled; otherwise the system runs in **single-speaker fallback** mode and marks speaker-specific fields as unavailable.

