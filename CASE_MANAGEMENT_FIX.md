# Case management / alert workflow

The production build persists the complete welfare workflow:

```text
Prediction
  -> Case evaluation / persistence
  -> Automated alert
  -> Alert review / acknowledgement
  -> Case review: Approve / Modify / Hold
  -> What-if intervention analysis
  -> Record intervention
  -> Follow-up
  -> Audit event
```

API routes:

```text
GET  /welfare/cases
GET  /welfare/cases/{case_id}
POST /welfare/cases/evaluate
POST /welfare/cases/{case_id}/review
POST /welfare/cases/{case_id}/intervention
POST /welfare/cases/{case_id}/follow-up
GET  /welfare/alerts
POST /welfare/alerts/{alert_id}/review
```

This fixes the earlier issue where the Review buttons existed in the UI but did not have persistent backend state.
