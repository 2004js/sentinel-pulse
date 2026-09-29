# SIH 2026 — PS 26186 Requirement Map

Problem Statement: **AI-Based Predictive Personnel Stress and Welfare Monitoring System for Uniformed Forces**
Organization: **Ministry of Home Affairs / CRPF**

| PS requirement | SENTINEL PULSE v5 implementation | Production status |
| --- | --- | --- |
| Prediction Models | FastAPI AI engine using XGBoost + Random Forest ensemble, Isolation Forest anomaly detection, trajectory analysis, SHAP explanation, confidence/evidence gate, burnout model/proxy | Implemented; model governance/data validation required before real personnel use |
| Welfare Intervention Recommendation System | Persistent welfare cases, recommendation field, scenario / what-if analysis, human officer review, intervention recording, follow-up workflow | Implemented |
| Role-Based Access Control and Privacy Management Framework | Supabase Auth + server-side role lookup, officer/commander/personnel separation, Supabase RLS migration, privacy center, consent records | Implemented in production architecture; Supabase project must be configured |
| Automated Alerts for authorized welfare personnel | Persistent alert table, alert queue, officer-only alert access, acknowledge/review endpoint, linked case review | Implemented |
| Data anonymization and secure storage mechanisms | Salted subject hashing, AES-256-GCM application encryption for sensitive raw records/context, encrypted secure-record table, audit events | Implemented in application architecture; production secrets/database must be configured securely |

## Additional workflow coverage

- Persistent case IDs and case lifecycle state.
- Explainable “Why Now” view with contributing factors, confidence, persistence and corroboration.
- Human-in-the-loop gate: the model does not independently approve a welfare intervention.
- Commander workspace is aggregate-only; individual welfare cases are restricted to authorized welfare officers.
- Personnel daily pulse and consent controls.
- HRMS is a mock adapter in the prototype; connect the real CRPF-authorized HRMS interface before live personnel ingestion.
- The package is deployment-ready, but it is **not a claim of production approval or regulatory certification**. Real deployment requires organizational security review, data-governance approval, model validation and authorized infrastructure credentials.
