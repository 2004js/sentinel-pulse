# SENTINEL PULSE v5.1 — Production Deployment Build

**SIH 2026 · Problem Statement 26186 · MHA / CRPF**

AI-powered predictive personnel stress and welfare monitoring for uniformed forces.

## Start locally — SIH demo mode

### 1. Frontend

```powershell
npm install
npm run dev
```

### 2. Backend

```powershell
python -m pip install -r backend\requirements.txt
python -m uvicorn backend.app:app --reload --port 8000
```

Open:

```text
http://localhost:5173
```

Default local demo authentication is enabled by `.env.example`.

### Demo accounts

See `LOGIN_CREDENTIALS.md`.

## Start production mode

Follow `PRODUCTION_DEPLOYMENT.md`.

The production architecture uses:

```text
Vite/React
   + Supabase Auth
   ↓
FastAPI
   ↓
AI / SHAP / evidence gate
   ↓
Supabase PostgreSQL + RLS
```

The included Render and Vercel deployment contracts are ready for a repository connected to the respective services.

## Production configuration

Copy `.env.example` into the correct environment-specific secret configuration. Do not commit `.env`.

Production requires:

```text
APP_ENV=production
DEMO_AUTH_ENABLED=false
DATABASE_URL=<Postgres connection>
SUPABASE_URL=<project URL>
SENTINEL_ENCRYPTION_KEY_B64=<32-byte base64url secret>
SENTINEL_HASH_SALT=<long secret>
CORS_ORIGINS=<real frontend origin>
```

Frontend:

```text
VITE_SENTINEL_API_URL=<public FastAPI URL>
VITE_SUPABASE_URL=<Supabase URL>
VITE_SUPABASE_ANON_KEY=<publishable/anon key>
VITE_DEMO_AUTH=false
```

## Core product loop

```text
MONITOR → DETECT → PREDICT → EXPLAIN → RECOMMEND →
HUMAN REVIEW → INTERVENE → FOLLOW UP
```

## Important data note

The bundled dataset/model is **synthetic demonstration data**. It is not an approved CRPF operational dataset, and its demo metrics must not be presented as clinical or operational evidence.

The HRMS endpoint remains a mock adapter and must be replaced by an approved authenticated CRPF/MHA connector before operational use.

## Files you will configure

- `PRODUCTION_DEPLOYMENT.md` — deployment sequence and production checklist
- `PS_26186_TRACEABILITY.md` — requirement-to-feature mapping
- `supabase/migrations/` — Postgres schema + RLS
- `supabase/tests/` — RLS smoke checks
- `render.yaml` — Render API deployment contract
- `vercel.json` — Vercel frontend deployment contract
- `.env.example` — environment variables
- `scripts/generate_secrets.py` — local secret generation
- `scripts/assign_role.sql` — role assignment template

## Security boundary

SENTINEL PULSE is a welfare decision-support system. It should not diagnose personnel, create disciplinary classifications, make promotion decisions, or independently execute welfare actions.

## Model compatibility

The bundled model artifact is serialized with scikit-learn 1.8.0. Keep `scikit-learn==1.8.0` for local inference and deployment. See `MODEL_COMPATIBILITY.md`.
