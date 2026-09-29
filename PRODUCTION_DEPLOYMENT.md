# SENTINEL PULSE — Production Deployment

## Target
SIH 2026 Problem Statement 26186 — **AI-Based Predictive Personnel Stress and Welfare Monitoring System for Uniformed Forces**.
The application is scoped to the CRPF/MHA welfare workflow described by the PS.

## What this build contains
- React/Vite web application with three role workspaces: Personnel, Welfare Officer, Commander.
- FastAPI inference and welfare workflow API.
- XGBoost + Random Forest risk ensemble.
- Isolation Forest anomaly signal.
- GradientBoosting burnout regressor when the bundled development model is used.
- SHAP feature attribution.
- Personal-baseline, persistence and corroboration evidence gate.
- Persistent welfare case management.
- Persistent automated in-app alerts for authorized welfare officers.
- Alert acknowledgement/review with audit trail.
- Human welfare review: Approve / Modify / Hold.
- Welfare intervention recording and follow-up status.
- Scenario / what-if intervention analysis.
- Pseudonymous personnel identifiers and application-level AES-256-GCM encryption for stored sensitive records.
- Role-aware backend authorization.
- Supabase Auth/JWT verification for production login.
- Supabase PostgreSQL schema and RLS migration.
- Consent controls for personnel self-reporting and optional biometrics.
- Append-only-style audit event storage through the application workflow.
- Render deployment contract for FastAPI and Vercel deployment contract for Vite.

## Important boundary
This package is **deployment-ready**, not evidence that the system is approved for live CRPF operational use.
The bundled model data is synthetic. The current HRMS endpoint is a mock adapter. Before operational use, connect only approved CRPF/MHA data sources, replace synthetic training/evaluation data, complete security/privacy review, validate the models independently, and obtain the required approvals.

## Architecture

```text
Personnel / Welfare Officer / Commander
                |
                v
        React + Supabase Auth
                |
                v
             FastAPI
       /        |        \
     RBAC     AI Engine    Privacy/Audit
               |             |
      XGB + RF + IF + SHAP  AES-GCM
               |
        Evidence / False-positive Gate
               |
       Welfare Recommendation
               |
        Human Welfare Review
               |
     Case / Alert / Intervention
               |
      Supabase PostgreSQL + RLS
```

## 1. Create a Supabase project

Create a Supabase project and open the SQL editor.

Run:

```text
supabase/migrations/20260929000100_sentinel_pulse_prod.sql
```

Create the required Auth users in **Authentication → Users**.

Then assign application roles using:

```text
scripts/assign_role.sql
```

Use the same three role values used by the backend:

```text
officer
commander
personnel
```

The PS requires role-based visibility. Commander data is intentionally aggregate-only in the application workflow.

Supabase recommends enabling RLS on exposed tables and pairing table grants with explicit policies; this package includes those policies in the migration. citeturn236522search2turn236522search3

## 2. Generate production secrets

From the project root:

```powershell
python scripts\generate_secrets.py
```

Store the values in your production secret manager. Never commit them.

Required backend secrets:

```text
DATABASE_URL
SUPABASE_URL
SENTINEL_ENCRYPTION_KEY_B64
SENTINEL_HASH_SALT
CORS_ORIGINS
```

Do not enable demo authentication in production:

```text
DEMO_AUTH_ENABLED=false
```

## 3. Backend deployment

The included `render.yaml` is configured for a Render Web Service.

Connect the repository to Render and deploy the `sentinel-pulse-api` service.

Build command:

```text
pip install -r backend/requirements.txt
```

Start command:

```text
uvicorn backend.app:app --host 0.0.0.0 --port $PORT
```

Render documents the same FastAPI deployment pattern using a Python build command and a Uvicorn process bound to the platform port. citeturn236522search0turn236522search6

Set:

```text
APP_ENV=production
DATABASE_URL=<Supabase/Postgres connection string>
SUPABASE_URL=<your Supabase URL>
SUPABASE_JWT_AUDIENCE=authenticated
CORS_ORIGINS=https://<your-vercel-domain>
DEMO_AUTH_ENABLED=false
SEED_DEMO_DATA=false
ENABLE_SWAGGER=false
SENTINEL_ENCRYPTION_KEY_B64=<generated secret>
SENTINEL_HASH_SALT=<generated secret>
```

The backend verifies Supabase access tokens using the project's JWKS endpoint and only accepts users with an assigned Sentinel role.

## 4. Frontend deployment

Set Vercel environment variables:

```text
VITE_SENTINEL_API_URL=https://<your-render-api-domain>
VITE_SUPABASE_URL=<your Supabase URL>
VITE_SUPABASE_ANON_KEY=<your Supabase publishable/anon key>
VITE_DEMO_AUTH=false
```

Build:

```text
npm install
npm run build
```

The included `vercel.json` publishes the Vite `dist` output and routes SPA paths back to `index.html`.

## 5. First production login

1. Create a Supabase Auth user.
2. Insert that user's UUID into `public.user_roles` with `officer`, `commander`, or `personnel`.
3. Log in through the production UI.
4. The frontend receives the Supabase session.
5. The backend validates the bearer token and resolves the authorized Sentinel role.

## 6. Production workflow

### Welfare Officer

```text
Sign in
  -> Overview
  -> Run Live ML Assessment
  -> Persistent Case
  -> Automated Alert
  -> Alert Review / Acknowledge
  -> Why Now
  -> Approve / Modify / Hold
  -> What-if
  -> Record Intervention
  -> Follow-up
  -> Audit
```

### Commander

```text
Sign in
  -> Force Welfare
  -> Workload
  -> Reports
```

Commander endpoints do not return individual welfare case detail.

### Personnel

```text
Sign in
  -> My Wellbeing
  -> Daily Pulse
  -> Secure Sync
  -> Privacy & Consent
```

## 7. Replace the mock HRMS adapter

Current endpoint:

```text
GET /hrms/personnel/{token}
```

It deliberately returns mock data for the SIH build.

For deployment, replace the adapter with the approved CRPF/MHA integration contract. Keep the following principles:

- minimum necessary fields;
- authenticated service-to-service access;
- no geolocation tracking through Sentinel;
- no communication surveillance;
- pseudonymize before AI inference where possible;
- never expose raw operational HR records to commander views.

## 8. Model governance

The included training data is synthetic.

Before operational use:

1. Obtain an authorized anonymized force dataset.
2. Define labels using approved welfare/mental-health governance.
3. Train and validate the risk, burnout and anomaly models on held-out data.
4. Check calibration, false-positive rates and subgroup fairness.
5. Version the model bundle and metadata.
6. Record the model version with every case decision.
7. Establish a human review protocol.

Do **not** present the synthetic demo metrics as operational accuracy.

## 9. Security checklist before going live

- Supabase Auth enabled.
- Demo authentication disabled.
- Production secret values stored only in a secret manager.
- RLS migration applied.
- Database backup/restore configured.
- CORS restricted to the real frontend domain.
- HTTPS only.
- API docs disabled unless explicitly needed.
- Real HRMS integration security reviewed.
- Audit retention policy approved.
- Model governance and welfare review policy approved.
- Data retention and erasure procedures approved.
- Penetration/security testing completed.

## 10. PS alignment

| PS requirement | Production package implementation |
|---|---|
| Prediction Models | XGBoost + Random Forest ensemble, Isolation Forest, GradientBoosting burnout model, temporal trajectory, SHAP |
| Welfare Intervention Recommendation System | Recommendation, what-if scenario engine, officer review and intervention workflow |
| Role-Based Access Control & Privacy | Supabase Auth/JWT, backend role checks, user_roles table, RLS, commander aggregate-only API |
| Automated Alerts | Persistent `alerts` table, automated alert creation for gated elevated cases, welfare officer review endpoint |
| Data anonymization & secure storage | Salted pseudonymous subject hashes, AES-256-GCM encrypted sensitive records, audit events |
| Human-in-the-loop welfare decision | Review endpoints and no automated welfare action |

The PS itself is the controlling requirement source. The Sentinel Pulse report in the repository is treated as a solution reference, not as a substitute for the official PS.

## Current limitation that must remain visible in demonstrations

**This is predictive welfare decision support, not a diagnosis or disciplinary score.**

The final operational system must not be used for disciplinary decisions, promotion decisions or operational deployment decisions without explicit policy approval.
