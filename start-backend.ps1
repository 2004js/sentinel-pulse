$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$env:APP_ENV = 'development'
$env:DEMO_AUTH_ENABLED = 'true'
$env:SENTINEL_SESSION_SECRET = 'sentinel-local-demo-secret-change-before-production'

if (-not (Test-Path .venv)) {
  python -m venv .venv
}
.\.venv\Scripts\Activate.ps1

python -c "import fastapi, sqlalchemy, sklearn, xgboost, shap; print('Backend dependencies OK')"

if (-not (Test-Path backend\model_bundle.joblib)) {
  python backend\train_model.py
}

python -m uvicorn backend.app:app --reload --port 8000
