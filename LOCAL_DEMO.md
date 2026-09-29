# SENTINEL PULSE — Stable Local Demo

This build is optimized for a reliable local SIH demonstration. It uses:
- React/Vite frontend
- FastAPI backend
- SQLite local database
- Bundled XGBoost + Random Forest + Isolation Forest + SHAP model
- Demo role authentication
- Seeded welfare cases and alerts

## Start

From PowerShell in this folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\RUN_LOCAL_DEMO.ps1
```

Or use two terminals manually:

```powershell
.\.venv\Scripts\Activate.ps1
$env:APP_ENV='development'
$env:DEMO_AUTH_ENABLED='true'
$env:SENTINEL_SESSION_SECRET='sentinel-local-demo-secret-change-before-production'
python -m uvicorn backend.app:app --reload --port 8000
```

Second terminal:

```powershell
npm install
npm run dev
```

Open `http://localhost:5173`.

## Demo accounts

Welfare Officer: `welfare.officer@sentinel.local` / `Sentinel@123`
Commander: `commander@sentinel.local` / `Sentinel@123`
Personnel: `personnel@sentinel.local` / `Sentinel@123`

## Important

This local build uses synthetic demonstration data. It is for SIH demonstration and UI/API validation only. Do not use the bundled model metrics or seeded cases as CRPF operational evidence.
