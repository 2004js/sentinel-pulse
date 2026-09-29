from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Generator

from sqlalchemy import Boolean, DateTime, Float, Integer, JSON, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def database_url() -> str:
    raw = os.getenv("DATABASE_URL", "sqlite:///./sentinel_pulse.db")
    if raw.startswith("postgres://"):
        raw = "postgresql+psycopg://" + raw[len("postgres://") :]
    elif raw.startswith("postgresql://"):
        raw = "postgresql+psycopg://" + raw[len("postgresql://") :]
    return raw


class Base(DeclarativeBase):
    pass


class UserRole(Base):
    __tablename__ = "user_roles"
    user_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class WelfareCase(Base):
    __tablename__ = "welfare_cases"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    personnel_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    personnel_token_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    risk_score: Mapped[int] = mapped_column(Integer, nullable=False)
    risk_tier: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    trajectory: Mapped[str | None] = mapped_column(String(32), nullable=True)
    priority: Mapped[str] = mapped_column(String(16), default="MEDIUM", nullable=False)
    primary_factors: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="OPEN", nullable=False, index=True)
    recommendation: Mapped[str] = mapped_column(Text, default="Welfare officer review recommended.", nullable=False)
    officer_decision: Mapped[str | None] = mapped_column(String(16), nullable=True)
    intervention: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    follow_up_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    personnel_context_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="OPEN", nullable=False, index=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class Intervention(Base):
    __tablename__ = "interventions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    intervention_type: Mapped[str] = mapped_column(String(140), nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    follow_up_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    outcome: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class ConsentRecord(Base):
    __tablename__ = "consents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    consent_type: Mapped[str] = mapped_column(String(32), nullable=False)
    granted: Mapped[bool] = mapped_column(Boolean, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False, index=True)
    actor_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    subject_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    event: Mapped[str] = mapped_column(String(80), nullable=False)
    outcome: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class SecureRecord(Base):
    __tablename__ = "secure_records"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    subject_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    record_type: Mapped[str] = mapped_column(String(80), nullable=False)
    ciphertext: Mapped[str] = mapped_column(Text, nullable=False)


ENGINE = create_engine(
    database_url(),
    pool_pre_ping=True,
    future=True,
    connect_args={"check_same_thread": False} if database_url().startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=ENGINE, autoflush=False, autocommit=False, expire_on_commit=False, class_=Session)


def init_db() -> None:
    Base.metadata.create_all(ENGINE)


def get_db() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
