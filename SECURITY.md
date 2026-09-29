# SENTINEL PULSE Security / Go-Live Checklist

This document is an implementation checklist, not a statement of legal or government certification.

## Before production

- Create Supabase Auth users only through the authorized identity process.
- Assign `officer`, `commander`, or `personnel` in `public.user_roles`.
- Apply the Supabase migration and verify RLS policies.
- Set `DEMO_AUTH_ENABLED=false`.
- Generate and store `SENTINEL_ENCRYPTION_KEY_B64` and `SENTINEL_HASH_SALT` outside source control.
- Restrict `CORS_ORIGINS` to the deployed frontend origin.
- Keep Swagger disabled unless explicitly required.
- Use HTTPS for every public endpoint.
- Configure Postgres backup, restore and retention policies.
- Replace the mock HRMS adapter with the approved CRPF/MHA integration.
- Replace synthetic training/evaluation data with an authorized anonymized dataset before operational model claims.
- Complete model calibration, false-positive analysis, subgroup/fairness review and human welfare validation.
- Complete application security testing and organizational approval before processing live personnel data.

## Data handling principles implemented by this package

- Pseudonymous subject hashes are used in audit and record paths.
- Sensitive stored payloads can be encrypted with AES-256-GCM.
- Browser clients do not write directly to `secure_records`.
- Commander APIs are restricted to aggregate welfare summaries.
- Welfare actions require an authorized officer role.
- Alert acknowledgement, case review and intervention actions create audit events.
- No geolocation, communications monitoring or continuous biometric surveillance is implemented by the prototype.

## Incident response

Define an organization-owned incident response process before go-live, including access revocation, credential rotation, database recovery, audit review, affected-data assessment and any legally required notifications.
