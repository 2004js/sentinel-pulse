# PS 26186 traceability

Problem Statement: **AI-Based Predictive Personnel Stress and Welfare Monitoring System for Uniformed Forces**.
Organization: **Ministry of Home Affairs**.
Department: **CRPF, Police II Division**.
Category: **Software**.
Theme: **MedTech / BioTech / HealthTech**.

## Required capabilities from the PS

1. Prediction Models
2. Welfare Intervention Recommendation System
3. Role-Based Access Control and Privacy Management Framework
4. Automated Alerts for authorized welfare personnel
5. Data anonymization and secure storage mechanisms

## Implementation trace

### 1. Prediction Models

- `/predict`
- `/trajectory`
- `backend/model_bundle.joblib`
- XGBoost + Random Forest ensemble
- Isolation Forest anomaly detector
- GradientBoosting burnout regressor when present in the bundle
- SHAP feature attribution
- Personal baseline
- Persistence + corroboration + confidence evidence gate

### 2. Welfare Intervention Recommendation System

- `/welfare/cases/evaluate`
- `/welfare/cases/{case_id}/review`
- `/welfare/cases/{case_id}/intervention`
- `/welfare/cases/{case_id}/follow-up`
- `/what-if`
- Frontend Intervention workspace

### 3. RBAC and privacy

Roles:

- `officer`
- `commander`
- `personnel`

Production authentication:

- Supabase Auth
- JWT verification
- `user_roles`
- Postgres RLS
- backend role checks

### 4. Automated Alerts

- `alerts` persistent store
- alerts generated only when the evidence gate is met or a persistent elevated signal exists
- `/welfare/alerts`
- `/welfare/alerts/{alert_id}/review`
- authorized welfare officer only

### 5. Anonymization and secure storage

- salted SHA-256 subject hashes
- AES-256-GCM application encryption for sensitive stored records
- `secure_records`
- append-only application audit events

## Not claimed as complete operational integrations

- CRPF HRMS production connector
- approved operational dataset
- operational model validation/calibration
- government security authorization
- clinical diagnosis
- production incident notification process
- final legal/privacy approval

Those require external organizational approval and infrastructure configuration.
