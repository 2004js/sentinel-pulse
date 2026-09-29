"""SENTINEL PULSE synthetic development model trainer.

The bundled dataset is synthetic and is for SIH demonstration only. It must be
replaced with an authorized anonymized force dataset and independently validated
before any operational use.
"""
from __future__ import annotations
from pathlib import Path
import json
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor, IsolationForest, RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score, mean_squared_error, r2_score, roc_auc_score
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier

ROOT = Path(__file__).resolve().parent
MODEL_PATH = ROOT / "model_bundle.joblib"
META_PATH = ROOT / "model_meta.json"
CSV_PATH = ROOT / "synthetic_training_data.csv"

FEATURES = [
    "avg_mood", "mood_slope", "low_mood_days", "deployment_months", "leave_denials",
    "overtime_hours", "sleep_disruption_days", "distress_days", "phq2", "gad2",
    "engagement_streak", "duty_hours_per_week", "transfer_frequency_12m",
    "training_commitments", "workload_trend", "biometric_authorized", "hrv", "sleep_hours"
]


def make_data(n: int = 10000, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    df = pd.DataFrame({
        "avg_mood": np.clip(rng.normal(3.2, .62, n), 1, 5),
        "mood_slope": np.clip(rng.normal(0, .28, n), -1, 1),
        "low_mood_days": rng.poisson(1.2, n).clip(0, 7),
        "deployment_months": rng.integers(0, 37, n),
        "leave_denials": rng.integers(0, 5, n),
        "overtime_hours": rng.integers(0, 45, n),
        "sleep_disruption_days": rng.poisson(1.5, n).clip(0, 7),
        "distress_days": rng.poisson(1.0, n).clip(0, 7),
        "phq2": rng.integers(0, 7, n),
        "gad2": rng.integers(0, 7, n),
        "engagement_streak": rng.integers(0, 31, n),
        "duty_hours_per_week": np.clip(rng.normal(54, 9, n), 30, 90),
        "transfer_frequency_12m": rng.integers(0, 6, n),
        "training_commitments": rng.integers(0, 7, n),
        "workload_trend": np.clip(rng.normal(.15, .35, n), -1, 1),
        "biometric_authorized": rng.binomial(1, .45, n),
        "hrv": np.clip(rng.normal(62, 14, n), 25, 110),
        "sleep_hours": np.clip(rng.normal(6.8, 1.25, n), 3, 10),
    })
    latent = (
        .62*(3.2-df.avg_mood) + .95*(-df.mood_slope) + .26*df.low_mood_days
        + .055*df.deployment_months + .28*df.leave_denials + .036*df.overtime_hours
        + .28*df.sleep_disruption_days + .22*df.distress_days + .43*df.phq2 + .37*df.gad2
        - .025*df.engagement_streak + .025*(df.duty_hours_per_week-48)
        + .22*df.transfer_frequency_12m + .18*df.training_commitments + 1.2*df.workload_trend
        + .10*df.biometric_authorized*(60-df.hrv) + .18*(6.5-df.sleep_hours)
        + rng.normal(0, .75, n)
    )
    p = 1/(1+np.exp(-(latent-2.45)))
    df["risk_label"] = (rng.random(n) < p).astype(int)
    # Synthetic burnout target for SIH development only. It is intentionally
    # derived from observable workload/wellness signals and is not a clinical label.
    burnout_latent = (
        42
        + 7.5*df["phq2"] + 6.5*df["gad2"]
        + 1.35*df["overtime_hours"]
        + 2.7*df["sleep_disruption_days"]
        + 3.0*df["distress_days"]
        + 1.05*(df["duty_hours_per_week"] - 48)
        + 13.0*df["workload_trend"]
        + 2.2*df["leave_denials"]
        + 0.8*df["deployment_months"]
        - 4.2*df["avg_mood"]
        - 0.55*df["engagement_streak"]
        + 0.7*(6.8 - df["sleep_hours"]) * 10
        + rng.normal(0, 7.0, n)
    )
    df["burnout_target"] = np.clip(burnout_latent, 0, 100)
    return df


def main() -> None:
    df = make_data()
    df.to_csv(CSV_PATH, index=False)
    x_train, x_test, y_train, y_test = train_test_split(
        df[FEATURES], df.risk_label, test_size=.2, random_state=42, stratify=df.risk_label
    )
    x_train_reg, x_test_reg, y_train_reg, y_test_reg = train_test_split(
        df[FEATURES], df.burnout_target, test_size=.2, random_state=42
    )

    rf = RandomForestClassifier(
        n_estimators=420, max_depth=12, min_samples_leaf=4,
        random_state=42, class_weight="balanced_subsample", n_jobs=-1
    )
    xgb = XGBClassifier(
        n_estimators=420, max_depth=5, learning_rate=.045, subsample=.85,
        colsample_bytree=.85, reg_lambda=2.0, objective="binary:logistic",
        eval_metric="logloss", random_state=42, n_jobs=4
    )
    burnout = GradientBoostingRegressor(
        n_estimators=360, learning_rate=0.035, max_depth=3,
        min_samples_leaf=8, subsample=.85, random_state=42
    )
    anomaly = IsolationForest(
        n_estimators=260, contamination=.08, random_state=42, n_jobs=-1
    )

    rf.fit(x_train, y_train)
    xgb.fit(x_train, y_train)
    burnout.fit(x_train_reg, y_train_reg)
    anomaly.fit(x_train)

    rf_p = rf.predict_proba(x_test)[:, 1]
    xgb_p = xgb.predict_proba(x_test)[:, 1]
    p = .45 * rf_p + .55 * xgb_p
    pred = (p >= .5).astype(int)
    burnout_pred = np.clip(burnout.predict(x_test_reg), 0, 100)

    bundle = {"rf": rf, "xgb": xgb, "burnout": burnout, "anomaly": anomaly, "features": FEATURES}
    joblib.dump(bundle, MODEL_PATH)

    meta = {
        "models": ["XGBoost", "RandomForestClassifier", "GradientBoostingRegressor", "IsolationForest"],
        "ensemble_weights": {"xgb": .55, "rf": .45},
        "features": FEATURES,
        "training_data": "synthetic_demo_only",
        "training_rows": len(df),
        "validation_rows": len(x_test),
        "roc_auc": round(float(roc_auc_score(y_test, p)), 4),
        "accuracy": round(float(accuracy_score(y_test, pred)), 4),
        "f1": round(float(f1_score(y_test, pred)), 4),
        "burnout_r2": round(float(r2_score(y_test_reg, burnout_pred)), 4),
        "burnout_rmse": round(float(np.sqrt(mean_squared_error(y_test_reg, burnout_pred))), 4),
        "anomaly_detector": "IsolationForest",
        "explainability": "SHAP TreeExplainer on XGBoost",
        "warning": "Demo metrics are not clinical or operational evidence. Replace with approved anonymized force data before deployment."
    }
    META_PATH.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
