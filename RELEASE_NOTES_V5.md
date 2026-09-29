# SENTINEL PULSE v5.1.0 — Release Notes

## Scope
Production-oriented deployment package for SIH 2026 PS 26186, scoped to the CRPF/MHA welfare workflow.

## Included
- React/Vite frontend with Personnel, Welfare Officer and Commander workspaces.
- FastAPI backend with role enforcement.
- Supabase Auth/JWT production path and local demo-auth path.
- Supabase PostgreSQL schema with RLS policies.
- XGBoost + Random Forest ensemble risk scoring.
- Isolation Forest anomaly signal.
- SHAP explainability.
- Personal baseline, persistence, corroboration and confidence evidence gate.
- Burnout model support when the bundled GradientBoosting model is available; proxy fallback is explicitly labelled by the API.
- Persistent welfare cases.
- Persistent automated in-app alerts for authorized welfare officers.
- Alert acknowledgement/review, case review, intervention and follow-up lifecycle.
- Scenario / what-if intervention simulation.
- Consent controls, secure encrypted record storage and pseudonymous hashes.
- Audit event trail.
- Aggregate-only commander endpoints.
- Mock HRMS adapter with an explicit replacement boundary for approved CRPF/MHA integration.
- Render and Vercel deployment contracts.
- Docker support.
- SIH requirement traceability and deployment/security documentation.

## Validation completed in this build environment
- Python backend `py_compile`: PASS.
- FastAPI end-to-end test: PASS for login, health, welfare summary, case list/detail, alert review, case review, intervention, follow-up and audit.
- Commander access controls: individual welfare case access blocked with HTTP 403; individual prediction access blocked with HTTP 403.
- Personnel privacy workflow: consent read/write, secure record sync and erasure request accepted by backend.
- Frontend source was updated, but a full Vite production build was not executed here because the container could not complete npm dependency resolution within the available runtime. After extraction, run `npm install` and `npm run build` locally or in CI before deployment.

## Go-live blockers that require organizational configuration/approval
- Real Supabase project and credentials.
- Real CRPF/MHA-approved HRMS integration.
- Authorized operational/anonymized training and validation dataset.
- Independent model validation/calibration and fairness review.
- Security testing and deployment authorization.
- Data retention/erasure policy approval.
- Organization-approved incident response and audit retention.

The package is deployment-ready as software. It is not a claim of government approval, regulatory certification, clinical validation, or authorization to process real personnel data without the required controls.
