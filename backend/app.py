from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import secrets
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Optional

import joblib
import numpy as np
import pandas as pd
import shap
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .db import (
    SessionLocal,
    Alert,
    AuditEvent,
    ConsentRecord,
    Intervention,
    SecureRecord,
    UserRole,
    WelfareCase,
    get_db,
    init_db,
    utc_now,
)
from .security import AuthUser, current_user as security_current_user, is_demo_auth_enabled, make_demo_session, require_roles

ROOT = Path(__file__).resolve().parent
BUNDLE_PATH = ROOT / "model_bundle.joblib"
META_PATH = ROOT / "model_meta.json"
LOCAL_ENCRYPTION_KEY = ROOT / ".local_encryption_key"

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("sentinel")

APP_ENV = os.getenv("APP_ENV", "development").lower()


def parse_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    return [item.strip() for item in raw.split(",") if item.strip()]


app = FastAPI(
    title="SENTINEL PULSE API",
    version="5.0.0",
    description="AI-assisted personnel stress and welfare monitoring for SIH 2026 PS 26186.",
    docs_url=None if APP_ENV == "production" and os.getenv("ENABLE_SWAGGER", "false").lower() != "true" else "/docs",
    redoc_url=None if APP_ENV == "production" and os.getenv("ENABLE_SWAGGER", "false").lower() != "true" else "/redoc",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Sentinel-Session"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if APP_ENV == "production":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


FEATURES = [
    "avg_mood", "mood_slope", "low_mood_days", "deployment_months", "leave_denials",
    "overtime_hours", "sleep_disruption_days", "distress_days", "phq2", "gad2",
    "engagement_streak", "duty_hours_per_week", "transfer_frequency_12m",
    "training_commitments", "workload_trend", "biometric_authorized", "hrv", "sleep_hours",
]

try:
    BUNDLE = joblib.load(BUNDLE_PATH)
except Exception as exc:
    logger.warning("Model bundle unavailable: %s", exc)
    BUNDLE = None

META = json.loads(META_PATH.read_text(encoding="utf-8")) if META_PATH.exists() else {}

DEMO_PERSONNEL = {
    "token": "WF-DEMO-1001", "avg_mood": 3.1, "mood_slope": -0.06, "low_mood_days": 1, "deployment_months": 14,
    "leave_denials": 1, "overtime_hours": 12, "sleep_disruption_days": 1, "distress_days": 0, "phq2": 1, "gad2": 1,
    "engagement_streak": 6, "duty_hours_per_week": 52, "transfer_frequency_12m": 1, "training_commitments": 2,
    "workload_trend": 0.12, "biometric_authorized": 0, "hrv": 62, "sleep_hours": 6.5,
    "baseline": {"avg_mood": 3.6, "duty_hours_per_week": 48, "overtime_hours": 10, "sleep_hours": 7.2, "workload_trend": 0.05},
}

DEMO_USERS = {
    "welfare.officer@sentinel.local": {"role": "officer", "password_env": "SENTINEL_WELFARE_PASSWORD", "name": "Welfare Officer"},
    "commander@sentinel.local": {"role": "commander", "password_env": "SENTINEL_COMMANDER_PASSWORD", "name": "Commander"},
    "personnel@sentinel.local": {"role": "personnel", "password_env": "SENTINEL_PERSONNEL_PASSWORD", "name": "Personnel"},
}


class DemoLogin(BaseModel):
    role: str
    username: str
    password: str


class PredictionRequest(BaseModel):
    token: str = "WF-DEMO-1001"
    avg_mood: float = Field(3.0, ge=1, le=5)
    mood_slope: float = Field(0, ge=-1, le=1)
    low_mood_days: int = Field(0, ge=0, le=14)
    deployment_months: int = Field(12, ge=0, le=60)
    leave_denials: int = Field(0, ge=0, le=12)
    overtime_hours: float = Field(10, ge=0, le=100)
    sleep_disruption_days: int = Field(0, ge=0, le=30)
    distress_days: int = Field(0, ge=0, le=30)
    phq2: int = Field(0, ge=0, le=6)
    gad2: int = Field(0, ge=0, le=6)
    engagement_streak: int = Field(5, ge=0, le=90)
    duty_hours_per_week: float = Field(48, ge=20, le=120)
    transfer_frequency_12m: int = Field(0, ge=0, le=12)
    training_commitments: int = Field(0, ge=0, le=12)
    workload_trend: float = Field(0, ge=-1, le=1)
    biometric_authorized: int = Field(0, ge=0, le=1)
    hrv: float = Field(62, ge=20, le=130)
    sleep_hours: float = Field(7, ge=2, le=12)
    baseline: dict[str, float] = Field(default_factory=dict)


class TrajectoryRequest(BaseModel):
    prediction: PredictionRequest
    current_history: list[float] = Field(default_factory=list)


class WhatIfRequest(BaseModel):
    prediction: PredictionRequest
    workload_reduction: float = Field(0, ge=0, le=50)
    recovery_days: int = Field(0, ge=0, le=14)
    counselling: bool = False


class SecureRecordRequest(BaseModel):
    token: str
    record_type: str = "wellness_assessment"
    package: dict[str, Any]


class WelfareReviewRequest(BaseModel):
    decision: str = Field(pattern=r"^(APPROVE|MODIFY|HOLD)$")
    recommendation: str = ""


class WelfareInterventionRequest(BaseModel):
    intervention_type: str = "Welfare officer check-in"
    notes: str = ""
    follow_up_date: Optional[str] = None

    @field_validator("follow_up_date")
    @classmethod
    def valid_follow_up(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        date.fromisoformat(value)
        return value


class AlertReviewRequest(BaseModel):
    status: str = Field(default="ACKNOWLEDGED", pattern=r"^(ACKNOWLEDGED|CLOSED)$")


class ConsentPayload(BaseModel):
    self: bool = True
    hr: bool = True
    wellness: bool = True
    biometric: bool = False


class CaseEvaluateRequest(PredictionRequest):
    priority: Optional[str] = None
    personnel_user_id: Optional[str] = None


# -----------------------------------------------------------------------------
# Encryption / privacy helpers
# -----------------------------------------------------------------------------


def _key_bytes() -> bytes:
    value = os.getenv("SENTINEL_ENCRYPTION_KEY_B64")
    if value:
        raw = base64.urlsafe_b64decode(value.encode())
        if len(raw) != 32:
            raise RuntimeError("SENTINEL_ENCRYPTION_KEY_B64 must decode to exactly 32 bytes")
        return raw

    if APP_ENV == "production":
        raise RuntimeError("SENTINEL_ENCRYPTION_KEY_B64 is required in production")

    if not LOCAL_ENCRYPTION_KEY.exists():
        LOCAL_ENCRYPTION_KEY.write_bytes(secrets.token_bytes(32))
    return LOCAL_ENCRYPTION_KEY.read_bytes()


def encrypt_json(payload: dict[str, Any]) -> str:
    key = _key_bytes()
    nonce = os.urandom(12)
    data = json.dumps(payload, separators=(",", ":")).encode()
    encrypted = AESGCM(key).encrypt(nonce, data, None)
    return base64.urlsafe_b64encode(nonce + encrypted).decode()


def subject_hash(token: str) -> str:
    salt = os.getenv("SENTINEL_HASH_SALT", "development-sentinel-salt")
    return hashlib.sha256(f"{salt}:{token}".encode()).hexdigest()


# -----------------------------------------------------------------------------
# AI engine
# -----------------------------------------------------------------------------


def feature_frame(req: PredictionRequest) -> pd.DataFrame:
    payload = req.model_dump()
    row = {f: payload.get(f, 0) for f in FEATURES}
    return pd.DataFrame([row], columns=FEATURES)


def fallback_probability(x: pd.DataFrame) -> float:
    r = x.iloc[0]
    latent = (
        .62 * (3.2 - r.avg_mood) + .95 * (-r.mood_slope) + .26 * r.low_mood_days
        + .055 * r.deployment_months + .28 * r.leave_denials + .036 * r.overtime_hours
        + .28 * r.sleep_disruption_days + .22 * r.distress_days + .43 * r.phq2 + .37 * r.gad2
        - .025 * r.engagement_streak + .025 * (r.duty_hours_per_week - 48)
        + .22 * r.transfer_frequency_12m + .18 * r.training_commitments + 1.2 * r.workload_trend
        + .10 * r.biometric_authorized * (60 - r.hrv) + .18 * (6.5 - r.sleep_hours)
    )
    return float(1 / (1 + np.exp(-(latent - 2.45))))


def contributions(req: PredictionRequest) -> list[dict[str, Any]]:
    x = feature_frame(req).iloc[0]
    baseline = req.baseline or {}
    labels = {
        "avg_mood": "Average mood", "mood_slope": "Mood trajectory", "low_mood_days": "Low-mood frequency",
        "deployment_months": "Deployment duration", "leave_denials": "Leave recovery gap", "overtime_hours": "Overtime workload",
        "sleep_disruption_days": "Sleep disruption", "distress_days": "Reported distress", "phq2": "PHQ-2 screening signal",
        "gad2": "GAD-2 screening signal", "engagement_streak": "Wellness engagement", "duty_hours_per_week": "Duty load",
        "transfer_frequency_12m": "Transfer frequency", "training_commitments": "Training commitments", "workload_trend": "Workload trend",
        "hrv": "HRV signal", "sleep_hours": "Sleep duration",
    }
    signs = {
        "avg_mood": -1.6, "mood_slope": -8.5, "low_mood_days": .9, "deployment_months": .16, "leave_denials": 1.7,
        "overtime_hours": .13, "sleep_disruption_days": 1.0, "distress_days": .85, "phq2": 1.25, "gad2": 1.2,
        "engagement_streak": -.07, "duty_hours_per_week": .11, "transfer_frequency_12m": .85, "training_commitments": .55,
        "workload_trend": 4.0, "hrv": -.05, "sleep_hours": -.8,
    }
    out: list[dict[str, Any]] = []
    for feature in FEATURES:
        if feature == "biometric_authorized":
            continue
        value = float(x[feature])
        if feature in baseline:
            value -= float(baseline[feature])
        effect = value * signs.get(feature, 0)
        if abs(effect) < 0.35:
            continue
        out.append({
            "feature": labels.get(feature, feature),
            "feature_key": feature,
            "effect": round(effect, 2),
            "direction": "risk" if effect > 0 else "protective",
            "value": round(float(x[feature]), 2),
        })
    return sorted(out, key=lambda item: abs(item["effect"]), reverse=True)[:8]


def predict(req: PredictionRequest) -> dict[str, Any]:
    x = feature_frame(req)
    if BUNDLE:
        rf_p = float(BUNDLE["rf"].predict_proba(x)[:, 1][0])
        xgb_p = float(BUNDLE["xgb"].predict_proba(x)[:, 1][0])
        probability = .45 * rf_p + .55 * xgb_p
        anomaly_label = int(BUNDLE["anomaly"].predict(x)[0])
        anomaly_score = float(-BUNDLE["anomaly"].score_samples(x)[0])
        model_name = "XGBoost + Random Forest ensemble"
    else:
        probability = fallback_probability(x)
        anomaly_label, anomaly_score, model_name = 1, 0.0, "Development fallback model"

    score = int(np.clip(round(probability * 100), 0, 100))
    tier = "STABLE" if score < 35 else "WATCH" if score < 55 else "INTERVENTION" if score < 80 else "URGENT"
    confidence = int(np.clip(round(68 + abs(score - 50) * .45 + (12 if anomaly_label == -1 else 5)), 55, 97))

    baseline = req.baseline or {}
    deviations = []
    for feature in ["sleep_hours", "duty_hours_per_week", "overtime_hours", "avg_mood", "workload_trend"]:
        if feature in baseline:
            deviations.append(abs(float(getattr(req, feature)) - float(baseline[feature])))
    baseline_strength = int(np.clip(round(55 + min(40, np.mean(deviations) * 8 if deviations else 8)), 55, 95))
    evidence = int(np.clip(round(confidence * .55 + baseline_strength * .45), 0, 99))

    shap_payload = None
    try:
        if BUNDLE:
            explainer = shap.TreeExplainer(BUNDLE["xgb"])
            raw = explainer.shap_values(x)
            if isinstance(raw, list):
                raw = raw[-1]
            shap_payload = [
                {
                    "feature": feature,
                    "feature_key": feature,
                    "effect": round(float(value), 4),
                    "direction": "risk" if value > 0 else "protective",
                    "value": round(float(x.iloc[0][feature]), 3),
                }
                for feature, value in zip(FEATURES, raw[0])
                if feature != "biometric_authorized"
            ]
            shap_payload = sorted(shap_payload, key=lambda item: abs(item["effect"]), reverse=True)[:8]
    except Exception as exc:
        logger.warning("SHAP explanation unavailable: %s", exc)

    contrib = shap_payload or contributions(req)

    persistence = min(
        100,
        40 + req.low_mood_days * 7 + req.sleep_disruption_days * 5 + req.distress_days * 5 + max(0, req.workload_trend) * 25,
    )
    corroboration = int(
        np.clip(
            35
            + (req.overtime_hours >= 20) * 20
            + (req.sleep_disruption_days >= 2) * 15
            + (req.mood_slope < -.1) * 15
            + (req.workload_trend > .25) * 15,
            0,
            100,
        )
    )
    gate = {
        "personal_baseline": bool(baseline),
        "persistent_signal": persistence >= 55,
        "multiple_correlated_signals": corroboration >= 55,
        "sufficient_data": True,
        "confidence_threshold": confidence >= 70,
    }
    safe_to_escalate = all(gate.values()) and score >= 55
    if not safe_to_escalate and score >= 55:
        recommendation = "Elevated risk detected — escalation held pending corroborating evidence"
    elif safe_to_escalate and score >= 80:
        recommendation = "Urgent welfare review"
    elif safe_to_escalate:
        recommendation = "Welfare officer review within 24–48 hours"
    else:
        recommendation = "Continue observation"

    if BUNDLE and BUNDLE.get("burnout") is not None:
        burnout_score = int(np.clip(round(float(BUNDLE["burnout"].predict(x)[0])), 0, 100))
        burnout_model = "GradientBoostingRegressor"
    else:
        burnout_score = int(np.clip(round(score * .62 + max(0, req.duty_hours_per_week - 48) * .55 + max(0, 7 - req.sleep_hours) * 7), 0, 100))
        burnout_model = "Development proxy — not a trained burnout model"
    burnout_tier = "LOW" if burnout_score < 35 else "MODERATE" if burnout_score < 60 else "HIGH" if burnout_score < 80 else "VERY HIGH"

    trajectory = "Deteriorating" if req.mood_slope < -.05 or req.workload_trend > .08 else "Recovering" if req.mood_slope > .06 and req.workload_trend < 0 else "Stable"

    return {
        "score": score,
        "risk_score": score,
        "probability": round(probability, 4),
        "tier": tier,
        "risk_tier": tier,
        "burnout_score": burnout_score,
        "burnout_tier": burnout_tier,
        "burnout_model": burnout_model,
        "trajectory": trajectory,
        "confidence": confidence,
        "evidence_quality": evidence,
        "model": model_name,
        "models": ["XGBoost", "Random Forest", "Gradient Boosting", "Isolation Forest", "SHAP"],
        "anomaly_detected": anomaly_label == -1,
        "anomaly_score": round(anomaly_score, 4),
        "contributors": contrib,
        "decision_gate": gate,
        "safe_to_escalate": safe_to_escalate,
        "persistence_score": int(persistence),
        "corroboration_score": int(corroboration),
        "recommendation": recommendation,
        "limitation": "Predictive welfare decision support only. Not a diagnosis, disciplinary classification, or guaranteed intervention outcome.",
    }


def trajectory_result(req: PredictionRequest) -> dict[str, Any]:
    base = predict(req)
    current = base["score"]
    slope = req.mood_slope
    load = max(0, req.workload_trend) * 7 + max(0, req.overtime_hours - 12) * .12
    recovery = req.engagement_streak * .12
    drift = np.clip(((-slope) * 14) + load - recovery, -5, 9)
    values = [int(np.clip(round(current + drift * (days / 7)), 0, 100)) for days in (7, 14, 30)]
    direction = "Deteriorating" if values[0] > current + 3 else "Recovering" if values[0] < current - 3 else "Stable"
    return {"current": current, "days7": values[0], "days14": values[1], "days30": values[2], "direction": direction, "method": "model-informed temporal scenario"}


# -----------------------------------------------------------------------------
# Persistence / audit
# -----------------------------------------------------------------------------


def log_event(db: Session, user: AuthUser, subject: str | None, event: str, outcome: dict[str, Any]) -> None:
    db.add(
        AuditEvent(
            actor_user_id=user.user_id,
            role=user.role,
            subject_hash=subject_hash(subject) if subject else None,
            event=event,
            outcome=outcome,
        )
    )
    db.commit()


def case_priority(score: int, supplied: str | None = None) -> str:
    if supplied in {"LOW", "MEDIUM", "HIGH", "URGENT"}:
        return supplied
    if score >= 80:
        return "URGENT"
    if score >= 65:
        return "HIGH"
    if score >= 55:
        return "MEDIUM"
    return "LOW"


def case_payload(row: WelfareCase) -> dict[str, Any]:
    return {
        "case_id": row.case_id,
        "id": row.case_id,
        "risk_score": row.risk_score,
        "risk": row.risk_score,
        "risk_tier": row.risk_tier,
        "tier": row.risk_tier,
        "trajectory": row.trajectory,
        "priority": row.priority,
        "primary_factors": row.primary_factors or [],
        "driver": ", ".join(row.primary_factors or []),
        "trend": "↑" if row.trajectory == "Deteriorating" else "↓" if row.trajectory == "Recovering" else "→",
        "status": row.status,
        "recommendation": row.recommendation,
        "officer_decision": row.officer_decision,
        "intervention": row.intervention,
        "follow_up_date": row.follow_up_date,
        "model_json": row.model_json,
        "model": row.model_json,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "safe_to_escalate": bool((row.model_json or {}).get("safe_to_escalate")),
    }


def alert_payload(row: Alert) -> dict[str, Any]:
    return {
        "id": row.id,
        "alert_id": row.id,
        "case_id": row.case_id,
        "severity": row.severity,
        "tier": row.severity,
        "title": row.title,
        "detail": row.detail,
        "status": row.status,
        "reviewed_by": row.reviewed_by,
        "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def create_or_update_case(db: Session, req: CaseEvaluateRequest, user: AuthUser) -> WelfareCase:
    model = predict(req)
    trajectory = trajectory_result(req)
    existing = db.scalar(
        select(WelfareCase)
        .where(WelfareCase.personnel_token_hash == subject_hash(req.token), WelfareCase.status.notin_(["FOLLOW-UP COMPLETE", "CLOSED"]))
        .order_by(WelfareCase.updated_at.desc())
    )
    if not existing:
        prefix = "WF"
        last = db.scalar(select(func.count(WelfareCase.id))) or 0
        case_id = f"{prefix}-{last + 41:05d}"
        existing = WelfareCase(
            case_id=case_id,
            personnel_user_id=getattr(req, "personnel_user_id", None),
            personnel_token_hash=subject_hash(req.token),
            created_at=utc_now(),
        )
        db.add(existing)
    existing.risk_score = model["score"]
    existing.risk_tier = model["tier"]
    existing.trajectory = trajectory["direction"]
    existing.priority = case_priority(model["score"], getattr(req, "priority", None))
    existing.primary_factors = [item["feature"] for item in model["contributors"][:5]]
    existing.status = "UNDER REVIEW" if model["score"] >= 55 else "MONITOR"
    existing.recommendation = model["recommendation"]
    existing.model_json = model | {"trajectory_detail": trajectory}
    existing.personnel_context_ciphertext = encrypt_json(req.model_dump())
    existing.updated_at = utc_now()
    db.commit()
    db.refresh(existing)

    if model["score"] >= 55 and (model["safe_to_escalate"] or model["persistence_score"] >= 55):
        open_alert = db.scalar(select(Alert).where(Alert.case_id == existing.case_id, Alert.status == "OPEN"))
        if not open_alert:
            db.add(
                Alert(
                    case_id=existing.case_id,
                    severity=model["tier"],
                    title=f"{existing.case_id} requires welfare review",
                    detail=model["recommendation"],
                )
            )
            db.commit()
    return existing


def seed_welfare_cases(db: Session) -> None:
    if APP_ENV == "production" and os.getenv("SEED_DEMO_DATA", "false").lower() != "true":
        return
    if db.scalar(select(func.count(WelfareCase.id))) or 0:
        return
    profiles = [
        ("WF-00041", {**DEMO_PERSONNEL, "token": "WF-DEMO-1001", "avg_mood": 2.9, "mood_slope": -0.08, "overtime_hours": 22, "sleep_disruption_days": 5, "distress_days": 3, "phq2": 3, "gad2": 2, "duty_hours_per_week": 58, "workload_trend": 0.26, "sleep_hours": 6.0}, "HIGH", ["Sleep disruption", "Workload pressure", "Deployment duration", "Leave recovery gap"]),
        ("WF-00052", {**DEMO_PERSONNEL, "token": "WF-DEMO-1002", "avg_mood": 2.4, "mood_slope": -0.19, "low_mood_days": 4, "deployment_months": 19, "leave_denials": 3, "overtime_hours": 28, "sleep_disruption_days": 4, "distress_days": 2, "phq2": 4, "gad2": 3, "duty_hours_per_week": 64, "workload_trend": 0.48, "sleep_hours": 5.6}, "URGENT", ["Mood trajectory", "Overtime workload", "Deployment duration", "PHQ-2/GAD-2 signal"]),
        ("WF-00067", {**DEMO_PERSONNEL, "token": "WF-DEMO-1003", "avg_mood": 3.4, "mood_slope": -0.01, "leave_denials": 2, "overtime_hours": 19, "sleep_disruption_days": 2, "workload_trend": 0.21}, "LOW", ["Leave recovery gap", "Workload trend"]),
    ]
    for case_id, raw, priority, factors in profiles:
        req = CaseEvaluateRequest(**raw, priority=priority)
        model = predict(req)
        trajectory = trajectory_result(req)
        row = WelfareCase(
            case_id=case_id,
            personnel_token_hash=subject_hash(req.token),
            risk_score=model["score"],
            risk_tier=model["tier"],
            trajectory=trajectory["direction"],
            priority=priority,
            primary_factors=factors,
            status="UNDER REVIEW" if model["score"] >= 55 else "MONITOR",
            recommendation=model["recommendation"],
            model_json=model | {"trajectory_detail": trajectory},
            personnel_context_ciphertext=encrypt_json(req.model_dump()),
        )
        db.add(row)
        db.flush()
        if model["score"] >= 55:
            db.add(Alert(case_id=case_id, severity=model["tier"], title=f"{case_id} requires welfare review", detail=model["recommendation"]))
    db.commit()


# -----------------------------------------------------------------------------
# Startup / health / auth
# -----------------------------------------------------------------------------


def get_current_user(
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
    x_sentinel_session: Optional[str] = Header(default=None),
) -> AuthUser:
    return security_current_user(db, authorization, x_sentinel_session)


@app.on_event("startup")
def startup() -> None:
    init_db()
    with SessionLocal() as db_session:
        seed_welfare_cases(db_session)


@app.get("/health")
def health(db: Session = Depends(get_db)) -> dict[str, Any]:
    try:
        db.execute(select(func.count()).select_from(AuditEvent)).scalar()
        db_ok = True
    except Exception:
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "environment": APP_ENV,
        "model_loaded": BUNDLE is not None,
        "demo_auth_enabled": is_demo_auth_enabled(),
        "database": "ok" if db_ok else "error",
        "model_meta": META,
    }


@app.get("/health/ready")
def ready(db: Session = Depends(get_db)) -> dict[str, Any]:
    checks = {"database": False, "model": BUNDLE is not None}
    try:
        db.execute(select(func.count()).select_from(AuditEvent)).scalar()
        checks["database"] = True
    except Exception:
        pass
    return {"ready": all(checks.values()), "checks": checks}


@app.post("/auth/demo")
def auth_demo(req: DemoLogin) -> dict[str, str]:
    if not is_demo_auth_enabled():
        raise HTTPException(404, "Demo authentication is disabled")
    user = DEMO_USERS.get(req.username.strip().lower())
    if not user:
        raise HTTPException(401, "Invalid demo credentials")
    expected = os.getenv(user["password_env"], "Sentinel@123")
    if req.role != user["role"] or not secrets.compare_digest(req.password, expected):
        raise HTTPException(401, "Invalid username, password, or role")
    return {"session": make_demo_session(user["role"]), "role": user["role"], "display_name": user["name"]}


@app.get("/auth/me")
def auth_me(db: Session = Depends(get_db), authorization: Optional[str] = Header(default=None), x_sentinel_session: Optional[str] = Header(default=None)):
    user = current_user(db, authorization, x_sentinel_session)
    return {"role": user.role, "user_id": user.user_id, "email": user.email, "display_name": user.display_name, "auth_mode": user.auth_mode}


# -----------------------------------------------------------------------------
# Prediction / trajectory
# -----------------------------------------------------------------------------


@app.post("/predict")
def predict_endpoint(req: PredictionRequest, db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user)):
    require_roles(user, "personnel", "officer")
    result = predict(req)
    log_event(db, user, req.token, "PREDICTION", {"score": result["score"], "tier": result["tier"]})
    return result


@app.post("/trajectory")
def trajectory_endpoint(req: TrajectoryRequest, db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user)):
    require_roles(user, "personnel", "officer")
    result = trajectory_result(req.prediction)
    log_event(db, user, req.prediction.token, "TRAJECTORY", {"direction": result["direction"]})
    return result


@app.post("/what-if")
def what_if(req: WhatIfRequest, db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user)):
    require_roles(user, "officer")
    base = predict(req.prediction)
    reduction = req.workload_reduction * .22 + req.recovery_days * 1.8 + (5 if req.counselling else 0)
    after = int(np.clip(round(base["score"] - reduction), 0, 100))
    tier = "STABLE" if after < 35 else "WATCH" if after < 55 else "INTERVENTION" if after < 80 else "URGENT"
    result = {"before": base["score"], "after": after, "delta": base["score"] - after, "tier": tier, "assumptions": "Scenario simulation only; supports human welfare review."}
    log_event(db, user, req.prediction.token, "WHAT_IF", result)
    return result


# -----------------------------------------------------------------------------
# Welfare / case management / alerts
# -----------------------------------------------------------------------------


@app.get("/welfare/summary")
def welfare_summary(db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user)):
    require_roles(user, "officer", "commander")
    if user.role == "commander":
        cases = db.scalars(select(WelfareCase)).all()
        avg_risk = int(round(np.mean([row.risk_score for row in cases]))) if cases else 0
        return {
            "personnel_covered": int(os.getenv("FORCE_PERSONNEL_COVERED", "1284")),
            "emerging_signals": sum(1 for row in cases if row.risk_tier in {"WATCH", "INTERVENTION", "URGENT"}),
            "intervention_cases": sum(1 for row in cases if row.risk_tier in {"INTERVENTION", "URGENT"}),
            "recovering_cases": sum(1 for row in cases if row.trajectory == "Recovering"),
            "trend": {"current": avg_risk, "days7": max(0, avg_risk - 1), "days14": avg_risk, "days30": max(0, avg_risk - 3), "direction": "Stable"},
            "aggregate": {"welfare_index": 72, "workload_pressure": 64, "resource_gap": 11},
            "data_status": "Production mode — governed data pipeline",
            "role": user.role,
        }

    cases = db.scalars(select(WelfareCase).order_by(WelfareCase.risk_score.desc())).all()
    total = len(cases)
    intervention = sum(1 for row in cases if row.risk_tier in {"INTERVENTION", "URGENT"})
    urgent = sum(1 for row in cases if row.risk_tier == "URGENT")
    watch = sum(1 for row in cases if row.risk_tier == "WATCH")
    current = cases[0].risk_score if cases else predict(PredictionRequest(**DEMO_PERSONNEL))["score"]
    trend = trajectory_result(PredictionRequest(**DEMO_PERSONNEL))
    featured = case_payload(cases[0]) if cases else None
    return {
        "personnel_covered": int(os.getenv("FORCE_PERSONNEL_COVERED", "1284")),
        "emerging_signals": total,
        "intervention_cases": intervention,
        "recovering_cases": sum(1 for row in cases if row.trajectory == "Recovering"),
        "watch_cases": watch,
        "urgent_cases": urgent,
        "trend": trend,
        "featured_case": featured,
        "model": featured.get("model_json") if featured else None,
        "aggregate": {"welfare_index": 72, "workload_pressure": 64, "resource_gap": 11},
        "data_status": "Production mode — governed data pipeline",
        "role": user.role,
    }


@app.post("/welfare/cases/evaluate")
def evaluate_case(req: CaseEvaluateRequest, db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user)):
    require_roles(user, "officer")
    row = create_or_update_case(db, req, user)
    log_event(db, user, req.token, "WELFARE_CASE_EVALUATED", {"case_id": row.case_id, "risk_score": row.risk_score, "tier": row.risk_tier})
    return {"case": case_payload(row), "model": row.model_json, "message": f"{row.case_id} evaluated and persisted."}


@app.get("/welfare/cases")
def welfare_cases(db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user)):
    require_roles(user, "officer")
    rows = db.scalars(select(WelfareCase).order_by(WelfareCase.risk_score.desc(), WelfareCase.created_at.asc())).all()
    return {"cases": [case_payload(row) for row in rows], "data_status": "Governed welfare case store", "role": user.role}


@app.get("/welfare/cases/{case_id}")
def welfare_case_detail(case_id: str, db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user)):
    require_roles(user, "officer")
    row = db.scalar(select(WelfareCase).where(WelfareCase.case_id == case_id))
    if not row:
        raise HTTPException(404, "Welfare case not found")
    return case_payload(row)


@app.post("/welfare/cases/{case_id}/review")
def welfare_case_review(case_id: str, req: WelfareReviewRequest, db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user)):
    require_roles(user, "officer")
    row = db.scalar(select(WelfareCase).where(WelfareCase.case_id == case_id))
    if not row:
        raise HTTPException(404, "Welfare case not found")
    status = {"APPROVE": "REVIEWED", "MODIFY": "MODIFIED", "HOLD": "ON HOLD"}[req.decision]
    row.status = status
    row.officer_decision = req.decision
    row.recommendation = req.recommendation.strip() or row.recommendation
    row.updated_at = utc_now()
    db.commit()
    log_event(db, user, case_id, "WELFARE_CASE_REVIEW", {"case_id": case_id, "decision": req.decision, "status": status})
    return {"case": case_payload(row), "message": f"{case_id} review recorded as {status}."}


@app.post("/welfare/cases/{case_id}/intervention")
def welfare_case_intervention(case_id: str, req: WelfareInterventionRequest, db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user)):
    require_roles(user, "officer")
    row = db.scalar(select(WelfareCase).where(WelfareCase.case_id == case_id))
    if not row:
        raise HTTPException(404, "Welfare case not found")
    item = {
        "type": req.intervention_type,
        "notes": req.notes,
        "follow_up_date": req.follow_up_date,
        "recorded_at": utc_now().isoformat(),
    }
    row.intervention = item
    row.follow_up_date = req.follow_up_date
    row.status = "INTERVENTION"
    row.updated_at = utc_now()
    db.add(Intervention(case_id=case_id, intervention_type=req.intervention_type, notes=req.notes, follow_up_date=req.follow_up_date, created_by=user.user_id))
    db.commit()
    log_event(db, user, case_id, "WELFARE_INTERVENTION", {"case_id": case_id, "intervention_type": req.intervention_type, "follow_up_date": req.follow_up_date})
    return {"case": case_payload(row), "message": f"Intervention recorded for {case_id}."}


@app.post("/welfare/cases/{case_id}/follow-up")
def welfare_case_follow_up(case_id: str, db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user)):
    require_roles(user, "officer")
    row = db.scalar(select(WelfareCase).where(WelfareCase.case_id == case_id))
    if not row:
        raise HTTPException(404, "Welfare case not found")
    row.status = "FOLLOW-UP COMPLETE"
    row.updated_at = utc_now()
    db.commit()
    log_event(db, user, case_id, "WELFARE_FOLLOW_UP_COMPLETE", {"case_id": case_id})
    return {"case": case_payload(row), "message": f"Follow-up recorded for {case_id}."}


@app.get("/welfare/alerts")
def welfare_alerts(db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user)):
    require_roles(user, "officer")
    rows = db.scalars(select(Alert).order_by(Alert.created_at.desc())).all()
    return {"alerts": [alert_payload(row) for row in rows]}


@app.post("/welfare/alerts/{alert_id}/review")
def welfare_alert_review(alert_id: str, req: AlertReviewRequest, db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user)):
    require_roles(user, "officer")
    row = db.get(Alert, alert_id)
    if not row:
        raise HTTPException(404, "Alert not found")
    row.status = req.status
    row.reviewed_by = user.user_id
    row.reviewed_at = utc_now()
    db.commit()
    log_event(db, user, row.case_id, "WELFARE_ALERT_REVIEW", {"alert_id": alert_id, "status": req.status, "case_id": row.case_id})
    return {"alert": alert_payload(row), "case_id": row.case_id, "message": f"Alert {alert_id} marked {req.status}."}


# -----------------------------------------------------------------------------
# HRMS / secure records / privacy / audit
# -----------------------------------------------------------------------------


@app.get("/hrms/personnel/{token}")
def hrms_personnel(token: str, db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user)):
    require_roles(user, "officer")
    # Mock adapter for the SIH build. Replace with an authenticated CRPF HRMS connector in deployment.
    return {
        "token": token,
        "rank": "Constable",
        "unit": "North Sector Demo Unit",
        "deployment_months": 18,
        "leave_denials": 2,
        "overtime_hours": 27,
        "duty_hours_per_week": 61,
        "transfer_frequency_12m": 2,
        "training_commitments": 4,
        "workload_trend": .42,
        "station_hardship": "Remote Border",
        "data_source": "Mock HRMS adapter — replace with approved CRPF HRMS integration",
    }


@app.post("/records/sync")
def secure_sync(req: SecureRecordRequest, db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user)):
    require_roles(user, "personnel", "officer")
    # Personnel cannot choose another person's identifier. Officers may sync an
    # authorized source record explicitly when performing controlled workflows.
    token = req.token if user.role == "officer" else f"user:{user.user_id}"
    digest = subject_hash(token)
    db.add(
        SecureRecord(
            subject_hash=digest,
            role=user.role,
            record_type=req.record_type,
            ciphertext=encrypt_json(req.package),
        )
    )
    db.commit()
    log_event(db, user, token, "SECURE_RECORD_SYNC", {"encrypted": True, "record_type": req.record_type})
    return {"synced": True, "encrypted": True, "subject_hash": digest}


@app.get("/privacy/consent")
def get_consent(db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user)):
    require_roles(user, "personnel")
    rows = db.scalars(select(ConsentRecord).where(ConsentRecord.user_id == user.user_id)).all()
    data = {"self": True, "hr": True, "wellness": True, "biometric": False}
    for row in rows:
        if row.consent_type in data:
            data[row.consent_type] = row.granted
    return data


@app.post("/privacy/consent")
def set_consent(payload: ConsentPayload, db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user)):
    require_roles(user, "personnel")
    values = payload.model_dump()
    for consent_type, granted in values.items():
        row = db.scalar(select(ConsentRecord).where(ConsentRecord.user_id == user.user_id, ConsentRecord.consent_type == consent_type))
        if row:
            row.granted = granted
            row.updated_at = utc_now()
        else:
            db.add(ConsentRecord(user_id=user.user_id, consent_type=consent_type, granted=granted))
    db.commit()
    log_event(db, user, None, "CONSENT_UPDATED", values)
    return values


@app.post("/privacy/erase-request")
def erase_request(db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user)):
    require_roles(user, "personnel")
    log_event(db, user, None, "ERASURE_REQUEST", {"requested": True})
    return {"accepted": True, "message": "Erasure request recorded for authorized privacy processing."}


@app.get("/audit/summary")
def audit_summary(db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user)):
    require_roles(user, "officer")
    rows = db.scalars(select(AuditEvent).order_by(AuditEvent.id.desc()).limit(40)).all()
    return {
        "events": [
            {
                "ts": row.ts.isoformat() if row.ts else None,
                "role": row.role,
                "subject_hash": row.subject_hash,
                "event": row.event,
                "outcome": row.outcome,
            }
            for row in rows
        ]
    }


@app.get("/model/info")
def model_info(db: Session = Depends(get_db), user: AuthUser = Depends(get_current_user)):
    require_roles(user, "officer", "commander")
    return {
        "bundle_loaded": BUNDLE is not None,
        "metadata": META,
        "design": {
            "risk": "XGBoost + Random Forest ensemble",
            "anomaly": "Isolation Forest",
            "burnout": "GradientBoosting regressor when trained bundle is present",
            "explainability": "SHAP TreeExplainer",
            "guard": "confidence + persistence + corroboration + baseline evidence gate",
        },
    }


@app.exception_handler(Exception)
async def unhandled_exception(request: Request, exc: Exception):
    logger.exception("Unhandled API error: %s", exc)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})
