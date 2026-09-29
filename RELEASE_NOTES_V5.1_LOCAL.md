# SENTINEL PULSE v5.1.0 — Local SIH Demo Stabilization

## What this release fixes
- Local demo authentication works without manually setting SENTINEL_SESSION_SECRET.
- Frontend and backend role names are aligned: `officer`, `commander`, `personnel`.
- Frontend API client remains Supabase-compatible but defaults to local demo mode.
- Case review, intervention, follow-up, automated alerts, HRMS, privacy, and audit APIs remain wired to FastAPI.
- Added RUN_LOCAL_DEMO.ps1 for Windows.
- Added LOCAL_DEMO.md and VIDEO_DEMO_SCRIPT.md for the SIH recording.

## Scope
This build is for local SIH demonstration and end-to-end workflow validation. The model and seeded records are synthetic demonstration data.
