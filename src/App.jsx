import { useEffect, useMemo, useState } from 'react';
import {
  audit,
  completeFollowUp,
  createIntervention,
  eraseRequest,
  evaluateCase,
  getCase,
  getConsent,
  health,
  hrms,
  login,
  logout,
  me,
  predict,
  reviewAlert,
  reviewCase,
  secureSync,
  setConsent as persistConsent,
  setSession,
  trajectory,
  welfareAlerts,
  welfareCases,
  welfareSummary,
  whatIf,
} from './lib/api';

const DEMO_PERSONNEL = {
  token: 'WF-DEMO-1001',
  avg_mood: 3.1,
  mood_slope: -0.06,
  low_mood_days: 1,
  deployment_months: 14,
  leave_denials: 1,
  overtime_hours: 12,
  sleep_disruption_days: 1,
  distress_days: 0,
  phq2: 1,
  gad2: 1,
  engagement_streak: 6,
  duty_hours_per_week: 52,
  transfer_frequency_12m: 1,
  training_commitments: 2,
  workload_trend: 0.12,
  biometric_authorized: 0,
  hrv: 62,
  sleep_hours: 6.5,
  baseline: { avg_mood: 3.6, duty_hours_per_week: 48, overtime_hours: 10, sleep_hours: 7.2, workload_trend: 0.05 },
};

const NAV = {
  officer: [
    ['overview', 'Overview'],
    ['cases', 'Welfare Cases'],
    ['why', 'Why Now'],
    ['intervention', 'Intervention'],
    ['alerts', 'Alerts'],
    ['hrms', 'HRMS Adapter'],
    ['audit', 'Audit'],
  ],
  commander: [
    ['overview', 'Force Welfare'],
    ['workload', 'Workload'],
    ['reports', 'Reports'],
  ],
  personnel: [
    ['home', 'My Wellbeing'],
    ['checkin', 'Daily Pulse'],
    ['assessment', 'Assessment'],
    ['privacy', 'Privacy & Consent'],
  ],
};

const normalizeRole = (value) => {
  const v = String(value || '').trim().toLowerCase();
  if (['officer', 'welfare_officer', 'welfare-officer', 'welfare officer'].includes(v)) return 'officer';
  if (v === 'commander') return 'commander';
  if (v === 'personnel') return 'personnel';
  return null;
};

const formatDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const formatPercent = (value) => value == null || Number.isNaN(Number(value)) ? '—' : `${Math.round(Number(value))}%`;
const scoreColorClass = (score) => (score >= 80 ? 'red' : score >= 55 ? 'amber' : 'green');
const tierClass = (value) => {
  const x = String(value || '').toUpperCase();
  if (x.includes('URGENT') || x.includes('HIGH') || x.includes('RED')) return 'red';
  if (x.includes('INTERVENTION') || x.includes('AMBER') || x.includes('MODERATE') || x.includes('WATCH')) return 'amber';
  return 'green';
};
const humanize = (value) => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const iconFor = (id) => ({ overview: '⌂', cases: '◫', why: '◌', intervention: '↗', alerts: '!', hrms: '◧', audit: '◉', workload: '▤', reports: '▥', home: '⌂', checkin: '◯', assessment: '✓', privacy: '◇' }[id] || '•');

function App() {
  const [role, setRole] = useState(() => normalizeRole(localStorage.getItem('sentinel_role_v5')));
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('sentinel_display_name_v5') || localStorage.getItem('sentinel_display_name_v4') || '');
  const [loginRole, setLoginRole] = useState(null);
  const [page, setPage] = useState(() => {
    const savedRole = normalizeRole(localStorage.getItem('sentinel_role_v5'));
    return NAV[savedRole]?.[0]?.[0] || 'overview';
  });
  const [healthState, setHealthState] = useState(null);
  const [model, setModel] = useState(null);
  const [trajectoryData, setTrajectoryData] = useState(null);
  const [welfareSummaryData, setWelfareSummaryData] = useState(null);
  const [casesData, setCasesData] = useState([]);
  const [alertsData, setAlertsData] = useState([]);
  const [selectedCase, setSelectedCase] = useState(null);
  const [caseState, setCaseState] = useState('');
  const [loadingIntelligence, setLoadingIntelligence] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const [scenario, setScenario] = useState({ workloadReduction: 20, recoveryDays: 3, counselling: true });
  const [scenarioResult, setScenarioResult] = useState(null);
  const [hr, setHr] = useState(null);
  const [auditData, setAuditData] = useState([]);
  const [consent, setConsentState] = useState({ self: true, hr: true, wellness: true, biometric: false });
  const [pulse, setPulse] = useState({ mood: 3, stress: 2, fatigue: 2, sleep: 3 });
  const [toast, setToast] = useState('');

  const flash = (msg) => {
    setToast(msg);
    window.clearTimeout(window.__sentinelToast);
    window.__sentinelToast = window.setTimeout(() => setToast(''), 3200);
  };

  const loadWelfareIntelligence = async (silent = false) => {
    if (!['officer', 'commander'].includes(normalizeRole(role))) return;
    setLoadingIntelligence(true);
    try {
      const summary = await welfareSummary();
      setWelfareSummaryData(summary || null);
      setTrajectoryData(summary?.trend || null);
      if (summary?.model) setModel(summary.model);

      if (normalizeRole(role) === 'officer') {
        const [cases, alerts] = await Promise.all([welfareCases(), welfareAlerts()]);
        setCasesData(Array.isArray(cases?.cases) ? cases.cases : []);
        setAlertsData(Array.isArray(alerts?.alerts) ? alerts.alerts : []);
      }
      if (!silent) flash('Live welfare intelligence refreshed');
    } catch (error) {
      if (!silent) flash(error?.message || 'Welfare intelligence endpoint unavailable');
    } finally {
      setLoadingIntelligence(false);
    }
  };

  const loadAudit = async () => {
    try {
      const result = await audit();
      setAuditData(Array.isArray(result?.events) ? result.events : []);
    } catch (error) {
      flash(error?.message || 'Audit endpoint unavailable');
    }
  };

  const loadConsent = async () => {
    try {
      const current = await getConsent();
      setConsentState(current || {});
    } catch {
      // Personnel-only endpoint; default local view remains available.
    }
  };

  const loadInitialAIOutput = async () => {
    try {
      const result = await predict(DEMO_PERSONNEL);
      if (result) setModel(result);
      const tr = await trajectory({ prediction: DEMO_PERSONNEL, current_history: [42, 46, 51, 57, 63, result?.score ?? 63] });
      setTrajectoryData(tr);
    } catch {
      // Preview inference is best-effort.
    }
  };

  const runRisk = async () => {
    setLoadingAction(true);
    try {
      let result;
      const activeRole = normalizeRole(role);
      if (activeRole === 'commander') {
        await loadWelfareIntelligence(false);
        flash('Aggregate welfare intelligence refreshed');
        return;
      }
      if (activeRole === 'officer') {
        const evaluated = await evaluateCase(DEMO_PERSONNEL);
        result = evaluated?.model || evaluated?.case?.model_json;
        if (evaluated?.case) {
          setSelectedCase(evaluated.case);
          setCaseState(evaluated.case.status || 'UNDER REVIEW');
        }
      } else {
        result = await predict(DEMO_PERSONNEL);
      }
      if (result) setModel(result);
      const tr = await trajectory({ prediction: DEMO_PERSONNEL, current_history: [42, 46, 51, 57, 63, result?.score ?? 63] });
      setTrajectoryData(tr);
      if (activeRole === 'officer') await loadWelfareIntelligence(true);
      flash('Predictive assessment completed');
    } catch (error) {
      flash(error?.message || 'Predictive assessment failed');
    } finally {
      setLoadingAction(false);
    }
  };

  const openCase = async (caseItem) => {
    setLoadingAction(true);
    try {
      const caseId = caseItem?.case_id || caseItem?.id;
      if (!caseId) throw new Error('Invalid welfare case ID');
      const detail = await getCase(caseId);
      setSelectedCase(detail);
      setCaseState(detail?.status || 'UNDER REVIEW');
      if (detail?.model_json && typeof detail.model_json === 'object') setModel(detail.model_json);
      if (detail?.model && typeof detail.model === 'object') setModel(detail.model);
      const trajectoryDetail = detail?.model_json?.trajectory_detail || detail?.model?.trajectory_detail;
      if (trajectoryDetail) setTrajectoryData(trajectoryDetail);
      setPage('why');
      flash(`Opened ${caseId}`);
    } catch (error) {
      flash(error?.message || 'Unable to open welfare case');
    } finally {
      setLoadingAction(false);
    }
  };

  const reviewSelectedCase = async (decision = 'APPROVE') => {
    const caseId = selectedCase?.case_id || selectedCase?.id;
    if (!caseId) {
      flash('Open a welfare case first');
      return;
    }
    setLoadingAction(true);
    try {
      const result = await reviewCase(caseId, {
        decision,
        recommendation: selectedCase?.recommendation || model?.recommendation || 'Welfare officer review recorded.',
      });
      setSelectedCase(result?.case || selectedCase);
      setCaseState(result?.case?.status || decision);
      const list = await welfareCases();
      setCasesData(Array.isArray(list?.cases) ? list.cases : []);
      flash(result?.message || `${caseId} review recorded`);
      await loadAudit();
    } catch (error) {
      flash(error?.message || 'Welfare case review failed');
    } finally {
      setLoadingAction(false);
    }
  };

  const recordIntervention = async (payload = {}) => {
    const caseId = selectedCase?.case_id || selectedCase?.id;
    if (!caseId) {
      flash('Open a welfare case first');
      return;
    }
    setLoadingAction(true);
    try {
      const result = await createIntervention(caseId, {
        intervention_type: payload.intervention_type || 'Welfare officer check-in',
        notes: payload.notes || 'Supportive welfare intervention recorded by authorized officer.',
        follow_up_date: payload.follow_up_date || null,
      });
      setSelectedCase(result?.case || selectedCase);
      setCaseState(result?.case?.status || 'INTERVENTION');
      await loadWelfareIntelligence(true);
      flash(result?.message || `Intervention recorded for ${caseId}`);
      await loadAudit();
    } catch (error) {
      flash(error?.message || 'Unable to record intervention');
    } finally {
      setLoadingAction(false);
    }
  };

  const finishFollowUp = async () => {
    const caseId = selectedCase?.case_id || selectedCase?.id;
    if (!caseId) {
      flash('Open a welfare case first');
      return;
    }
    setLoadingAction(true);
    try {
      const result = await completeFollowUp(caseId);
      setSelectedCase(result?.case || selectedCase);
      setCaseState(result?.case?.status || 'FOLLOW-UP COMPLETE');
      await loadWelfareIntelligence(true);
      flash(result?.message || `Follow-up recorded for ${caseId}`);
      await loadAudit();
    } catch (error) {
      flash(error?.message || 'Unable to complete follow-up');
    } finally {
      setLoadingAction(false);
    }
  };

  const handleAlertReview = async (alertItem) => {
    const alertId = alertItem?.alert_id || alertItem?.id;
    if (!alertId) return;
    setLoadingAction(true);
    try {
      const reviewed = await reviewAlert(alertId, 'ACKNOWLEDGED');
      const [alerts, cases] = await Promise.all([welfareAlerts(), welfareCases()]);
      setAlertsData(Array.isArray(alerts?.alerts) ? alerts.alerts : []);
      setCasesData(Array.isArray(cases?.cases) ? cases.cases : []);
      const caseId = reviewed?.case_id || alertItem.case_id;
      const found = caseId ? (cases?.cases || []).find((item) => item.case_id === caseId || item.id === caseId) : null;
      if (found) await openCase(found);
      flash(reviewed?.message || 'Alert acknowledged');
    } catch (error) {
      flash(error?.message || 'Alert review failed');
    } finally {
      setLoadingAction(false);
    }
  };

  const runScenario = async () => {
    setLoadingAction(true);
    try {
      const result = await whatIf({ prediction: DEMO_PERSONNEL, ...scenario });
      setScenarioResult(result);
      flash('Scenario simulation completed');
    } catch (error) {
      flash(error?.message || 'Scenario engine unavailable');
    } finally {
      setLoadingAction(false);
    }
  };

  const loadHrms = async () => {
    setLoadingAction(true);
    try {
      const record = await hrms(DEMO_PERSONNEL.token);
      setHr(record);
      flash('Mock HRMS record loaded');
    } catch (error) {
      flash(error?.message || 'HRMS adapter unavailable');
    } finally {
      setLoadingAction(false);
    }
  };

  const saveConsent = async (nextConsent) => {
    try {
      const saved = await persistConsent(nextConsent);
      setConsentState(saved || nextConsent);
      flash('Consent settings saved securely');
    } catch (error) {
      flash(error?.message || 'Unable to save consent settings');
    }
  };

  const savePulse = async () => {
    try {
      await secureSync({ token: DEMO_PERSONNEL.token, record_type: 'daily_pulse', package: pulse });
      flash('Daily Pulse stored securely');
    } catch (error) {
      flash(error?.message || 'Daily Pulse could not be stored');
    }
  };

  const requestErase = async () => {
    try {
      await eraseRequest();
      flash('Erasure request recorded for authorized privacy processing');
    } catch (error) {
      flash(error?.message || 'Unable to submit erasure request');
    }
  };

  const signIn = async (nextRole, username, password) => {
    const data = await login(nextRole, username, password);
    const normalizedRole = normalizeRole(data?.role || nextRole);
    if (!NAV[normalizedRole]) throw new Error('Unsupported workspace role');
    setRole(normalizedRole);
    setDisplayName(data?.display_name || nextRole);
    localStorage.setItem('sentinel_role_v5', normalizedRole);
    localStorage.setItem('sentinel_display_name_v5', data?.display_name || nextRole);
    setLoginRole(null);
    setPage(NAV[normalizedRole][0][0]);
    flash(`${data?.display_name || nextRole} workspace ready`);
  };

  const signOut = async () => {
    await logout().catch(() => {});
    setSession('');
    localStorage.removeItem('sentinel_session_v5');
    localStorage.removeItem('sentinel_role_v5');
    localStorage.removeItem('sentinel_display_name_v5');
    setRole(null);
    setDisplayName('');
    setLoginRole(null);
    setSelectedCase(null);
    setPage('overview');
    flash('Signed out securely');
  };

  useEffect(() => {
    health().then(setHealthState);
    const hasDemoSession = Boolean(localStorage.getItem('sentinel_session_v5'));
    const hasProductionAuth = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
    if (hasDemoSession || hasProductionAuth) {
      me().then((data) => {
        const normalizedRole = normalizeRole(data?.role);
        if (!normalizedRole) throw new Error('Invalid session role');
        setRole(normalizedRole);
        setDisplayName(data?.display_name || data?.email || normalizedRole);
        localStorage.setItem('sentinel_role_v5', normalizedRole);
        localStorage.setItem('sentinel_display_name_v5', data?.display_name || data?.email || normalizedRole);
        setPage(NAV[normalizedRole][0][0]);
      }).catch(() => {
        setSession('');
        localStorage.removeItem('sentinel_session_v5');
        localStorage.removeItem('sentinel_role_v5');
        localStorage.removeItem('sentinel_display_name_v5');
        setRole(null);
      });
    }
  }, []);

  useEffect(() => {
    const activeRole = normalizeRole(role);
    if (activeRole === 'officer' || activeRole === 'commander') {
      loadWelfareIntelligence(true);
      if (activeRole === 'officer') loadInitialAIOutput();
    }
    if (activeRole === 'personnel') loadConsent();
  }, [role]);

  const activeRole = normalizeRole(role);
  const roleLabel = activeRole === 'officer' ? 'Welfare Officer' : activeRole === 'commander' ? 'Commander' : 'Personnel';

  if (!activeRole) {
    return <Landing onSignIn={signIn} healthState={healthState} loginRole={loginRole} setLoginRole={setLoginRole} demoAuth={import.meta.env.VITE_DEMO_AUTH !== 'false'} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">S</div><div><strong>SENTINEL</strong><span>PULSE</span></div></div>
        <div className="role-chip"><span className="status-dot green" />{roleLabel}</div>
        <nav>
          {(NAV[activeRole] || []).map(([id, label]) => (
            <button key={id} className={page === id ? 'nav-item active' : 'nav-item'} onClick={() => { setPage(id); if (id === 'audit') loadAudit(); }}>
              <span className="icon" aria-hidden>{iconFor(id)}</span>{label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="mini-label">AI CORE</span>
          <strong>XGBoost + RF ensemble</strong>
          <small>SHAP explainability · Isolation Forest</small>
          <div className="sidebar-mode">Prototype · synthetic demo data</div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><div className="eyebrow">CRPF WELFARE INTELLIGENCE · SIH26186</div><h1>{pageTitle(activeRole, page)}</h1></div>
          <div className="top-actions">
            <span className={`api-pill ${healthState?.status === 'ok' ? 'online' : ''}`}><span className="status-dot" />AI {healthState?.status === 'ok' ? 'online' : 'offline'}</span>
            <span className="user-label">{displayName || roleLabel}</span>
            <button className="signout" onClick={signOut}>Sign out</button>
          </div>
        </header>
        <div className="content">
          <DemoBanner healthState={healthState} model={model} />
          {renderPage({
            role: activeRole,
            page,
            model,
            runRisk,
            trajectoryData,
            welfareSummaryData,
            casesData,
            alertsData,
            selectedCase,
            caseState,
            reviewSelectedCase,
            recordIntervention,
            finishFollowUp,
            openCase,
            handleAlertReview,
            loadingIntelligence,
            loadingAction,
            runScenario,
            scenario,
            setScenario,
            scenarioResult,
            hr,
            loadHrms,
            auditData,
            pulse,
            setPulse,
            savePulse,
            consent,
            setConsentState,
            saveConsent,
            requestErase,
          })}
        </div>
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function DemoBanner({ healthState, model }) {
  return (
    <div className="demo-banner">
      <div><strong>SIH prototype environment</strong><span>AI outputs are welfare decision-support signals; current model validation uses synthetic demo data.</span></div>
      <div className="demo-banner-meta">
        <span className="mini-chip">DB {healthState?.database === 'ok' ? 'OK' : '—'}</span>
        <span className="mini-chip">MODEL {healthState?.model_loaded ? 'LOADED' : '—'}</span>
        <span className={`mini-chip ${model ? 'live' : ''}`}>{model ? `RISK ${model.score}/100` : 'READY'}</span>
      </div>
    </div>
  );
}

function Landing({ onSignIn, healthState, loginRole, setLoginRole, demoAuth }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const roleCopy = {
    officer: { title: 'Welfare Officer', detail: 'Predictive analytics · cases · interventions', hint: 'Primary welfare workspace', username: 'welfare.officer@sentinel.local' },
    commander: { title: 'Commander', detail: 'Aggregate welfare · workload · reports', hint: 'Aggregate leadership view', username: 'commander@sentinel.local' },
    personnel: { title: 'Personnel', detail: 'Self-assessment · wellbeing · privacy', hint: 'Private personnel workspace', username: 'personnel@sentinel.local' },
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await onSignIn(loginRole, username.trim(), password);
    } catch (err) {
      setError(err?.message || 'Invalid username or password for the selected workspace.');
    }
  };

  const chooseRole = (r) => {
    setLoginRole(r);
    setUsername(roleCopy[r].username);
    setPassword('Sentinel@123');
    setError('');
  };

  return <div className="landing">
    <div className="landing-left">
      <div className="brand hero-brand"><div className="brand-mark">S</div><div><strong>SENTINEL</strong><span>PULSE</span></div></div>
      <div className="eyebrow">SIH 2026 · PS 26186 · MHA / CRPF</div>
      <h1>Detect earlier.<br/><em>Support smarter.</em><br/>Protect dignity.</h1>
      <p className="hero-copy">An AI-based predictive personnel stress and welfare monitoring system for uniformed forces. SENTINEL analyzes authorized HR and voluntary wellness signals, explains meaningful changes, routes welfare alerts, and keeps human review at the center.</p>
      <div className="hero-flow"><span>MONITOR</span><i>→</i><span>DETECT</span><i>→</i><span>EXPLAIN</span><i>→</i><span>INTERVENE</span><i>→</i><span>FOLLOW UP</span></div>
      <div className="landing-proof"><div><strong>18+</strong><span>signals in the predictive schema</span></div><div><strong>3</strong><span>role-specific workspaces</span></div><div><strong>1</strong><span>closed-loop welfare workflow</span></div></div>
    </div>
    <div className="landing-right">
      <div className="login-card">
        {!loginRole ? <>
          <div className="eyebrow">{demoAuth ? 'SECURE DEMO SIGN-IN' : 'SECURE SIGN-IN'}</div>
          <h2>Choose your workspace</h2>
          <p>{demoAuth ? 'Use a role-specific demonstration account to explore the complete welfare workflow.' : 'Access is restricted to information appropriate to your authorized role.'}</p>
          <RoleCard title="Welfare Officer" detail="Predictive analytics · cases · interventions" onClick={() => chooseRole('officer')} badge="PRIMARY" />
          <RoleCard title="Commander" detail="Aggregate welfare · workload · reports" onClick={() => chooseRole('commander')} />
          <RoleCard title="Personnel" detail="Self-assessment · wellbeing · privacy" onClick={() => chooseRole('personnel')} />
          <div className="login-note"><span className={`status-dot ${healthState?.status === 'ok' ? 'green' : ''}`} />{healthState?.status === 'ok' ? 'AI backend connected' : 'Start FastAPI on port 8000'}</div>
          <div className="login-trust">AI predictions are advisory. Welfare decisions remain with authorized personnel.</div>
        </> : <form onSubmit={submit}>
          <button type="button" className="back-link" onClick={() => setLoginRole(null)}>← Back to workspaces</button>
          <div className="eyebrow">{roleCopy[loginRole].hint.toUpperCase()}</div>
          <h2>Sign in as {roleCopy[loginRole].title}</h2>
          <p>{roleCopy[loginRole].detail}</p>
          <label className="field-label">Username<input className="auth-input" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} /></label>
          <label className="field-label">Password<div className="password-wrap"><input className="auth-input" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /><button type="button" className="show-password" onClick={() => setShowPassword(v => !v)}>{showPassword ? 'Hide' : 'Show'}</button></div></label>
          {error && <div className="auth-error">{error}</div>}
          <button className="primary full" type="submit">Sign in to {roleCopy[loginRole].title}<span>→</span></button>
          {demoAuth && <div className="demo-credential-box"><strong>SIH demo account</strong><span>Pre-filled credentials for this prototype build.</span><code>{roleCopy[loginRole].username}</code><code>Sentinel@123</code></div>}
        </form>}
      </div>
    </div>
  </div>;
}

function RoleCard({ title, detail, onClick, badge }) {
  return <button className="role-card" type="button" onClick={onClick}><div><strong>{title}</strong><span>{detail}</span></div>{badge ? <b>{badge}</b> : <span className="arrow">→</span>}</button>;
}

function renderPage(props) {
  const { role, page } = props;
  if (role === 'officer') {
    if (page === 'overview') return <OfficerOverview {...props} />;
    if (page === 'cases') return <Cases {...props} />;
    if (page === 'why') return <WhyNow {...props} />;
    if (page === 'intervention') return <Intervention {...props} />;
    if (page === 'alerts') return <Alerts {...props} />;
    if (page === 'hrms') return <HRMS {...props} />;
    if (page === 'audit') return <Audit {...props} />;
  }
  if (role === 'commander') {
    if (page === 'overview') return <CommanderOverview {...props} />;
    if (page === 'workload') return <CommanderWorkload />;
    if (page === 'reports') return <CommanderReports welfareSummaryData={props.welfareSummaryData} />;
  }
  if (role === 'personnel') {
    if (page === 'home') return <PersonnelHome />;
    if (page === 'checkin') return <DailyPulse {...props} />;
    if (page === 'assessment') return <Assessment />;
    if (page === 'privacy') return <Privacy {...props} />;
  }
  return <EmptyState text="This workspace is not available for the current role." />;
}

function OfficerOverview({ model, runRisk, trajectoryData, welfareSummaryData, loadingIntelligence, loadingAction, casesData, alertsData, openCase }) {
  const current = welfareSummaryData?.trend?.current ?? model?.score ?? null;
  const avg = useMemo(() => {
    if (!casesData.length) return null;
    return Math.round(casesData.reduce((sum, item) => sum + Number(item.risk_score ?? item.risk ?? 0), 0) / casesData.length);
  }, [casesData]);
  const openAlerts = alertsData.filter(a => String(a.status || 'OPEN').toUpperCase() === 'OPEN').length;

  return <>
    <div className="page-intro"><div><span className="section-kicker">LIVE WELFARE PICTURE</span><h2>Early signals, not labels.</h2><p>Identify persistent changes that may warrant human welfare review. Every escalation remains advisory and auditable.</p></div><button className="primary" onClick={runRisk} disabled={loadingAction || loadingIntelligence}>{loadingAction || loadingIntelligence ? 'Running…' : 'Run Live ML Assessment'} <span>→</span></button></div>
    <div className="metric-grid">
      <Metric label="Monitored personnel" value={welfareSummaryData?.personnel_covered ?? '—'} note="Authorized HR population" />
      <Metric label="Emerging signals" value={welfareSummaryData?.emerging_signals ?? casesData.length} note="Persistent change detected" accent="amber" />
      <Metric label="Intervention cases" value={welfareSummaryData?.intervention_cases ?? '—'} note={`${openAlerts} open welfare alerts`} accent="red" />
      <Metric label="Current risk" value={current == null ? '—' : `${current}/100`} note={avg == null ? 'Run assessment for live case output' : `Case average ${avg}/100`} accent={current == null ? '' : scoreColorClass(current)} />
    </div>
    <AIOutputPanel model={model} trajectoryData={trajectoryData} />
    <div className="grid-2-1">
      <Panel title="Risk trajectory" action={trajectoryData ? <span className={`tag ${tierClass(trajectoryData.direction)}`}>{trajectoryData.direction}</span> : null}>
        {trajectoryData ? <TrendChart data={[trajectoryData.current, trajectoryData.days7, trajectoryData.days14, trajectoryData.days30]} labels={['Now','7d','14d','30d']} /> : <EmptyState text="Run Live ML Assessment to populate model-informed trajectory intelligence." />}
      </Panel>
      <Panel title="AI assessment state">
        <div className="ai-summary">
          <div className={`score-ring ${model ? scoreColorClass(model.score) : ''}`}>{model ? model.score : '—'}<small>/100</small></div>
          <div>
            <strong>{model?.tier || 'Ready'}</strong>
            <p>{model?.recommendation || 'Model is ready for the demo workflow.'}</p>
            <div className="ai-mini-grid"><span>Confidence<b>{formatPercent(model?.confidence)}</b></span><span>Evidence<b>{formatPercent(model?.evidence_quality)}</b></span></div>
            <span className="tag">SHAP</span> <span className="tag">Anomaly</span>
          </div>
        </div>
      </Panel>
    </div>
    <Panel title="Priority signals">
      <div className="pattern-list">
        {(casesData.slice(0, 3).length ? casesData.slice(0, 3) : [
          { case_id: 'WF-DEMO-EXAMPLE', priority: 'HIGH', risk_score: 78, driver: 'Workload + sleep disruption + deployment', trajectory: 'Deteriorating' },
        ]).map((item, index) => <div className="pattern" key={item.case_id || index}><div className="pattern-mark" /><div><strong>{item.case_id || item.id}</strong><p>{item.driver || (item.primary_factors || []).slice(0, 3).join(' · ') || 'Multi-signal welfare pattern'}</p></div><span className={`tag ${tierClass(item.priority || item.tier)}`}>{item.priority || item.tier || 'REVIEW'}</span><button className="text-button" onClick={() => openCase(item)}>{item.case_id ? 'Open' : 'View'}</button></div>)}
      </div>
    </Panel>
  </>;
}

function AIOutputPanel({ model, trajectoryData }) {
  if (!model) return <Panel title="AI prediction output"><div className="notice"><strong>AI engine ready.</strong> Run the live assessment to generate a personnel-level welfare prediction.</div></Panel>;
  const topFactors = Array.isArray(model.contributors) ? model.contributors.slice(0, 3) : [];
  const probability = model.probability == null ? null : Math.round(Number(model.probability) * 100);
  const trajectory = trajectoryData?.direction || model.trajectory || 'Stable';
  const anomaly = model.anomaly_detected ? 'Detected' : 'Not detected';
  return <Panel title="Live AI prediction output" action={<span className="tag live">MODEL LIVE</span>}>
    <div style={{display:'grid',gridTemplateColumns:'190px 1fr',gap:20,alignItems:'stretch'}}>
      <div style={{border:'1px solid rgba(112,248,232,0.2)',borderRadius:16,padding:18,background:'rgba(5,18,32,0.45)',textAlign:'center'}}>
        <div className={`big-score ${scoreColorClass(Number(model.score || 0))}`} style={{fontSize:52,lineHeight:1}}>{model.score}<small>/100</small></div>
        <div style={{marginTop:12}}><span className={`tag ${tierClass(model.tier)}`}>{model.tier}</span></div>
        <div className="t-xs" style={{marginTop:10,color:'var(--outline-variant)'}}>Predicted welfare risk</div>
      </div>
      <div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:14}}>
          <AIScore label="Probability" value={probability == null ? '—' : `${probability}%`} />
          <AIScore label="Confidence" value={formatPercent(model.confidence)} />
          <AIScore label="Burnout" value={model.burnout_score == null ? '—' : `${model.burnout_score}/100`} />
          <AIScore label="Evidence" value={formatPercent(model.evidence_quality)} />
        </div>
        <div className="notice" style={{marginBottom:14}}><strong>AI interpretation:</strong> {model.recommendation || 'Continue observation'}<br/><span className="t-xs">Trajectory: {trajectory} · Anomaly signal: {anomaly} · Escalation gate: {model.safe_to_escalate ? 'PASSED' : 'HELD'}</span></div>
        <div style={{display:'grid',gridTemplateColumns:'1.35fr 1fr',gap:14}}>
          <div><div className="section-kicker" style={{marginBottom:8}}>TOP CONTRIBUTING SIGNALS</div>
            <div className="factor-grid" style={{gridTemplateColumns:'1fr'}}>
              {topFactors.length ? topFactors.map((x,i)=><div className="factor" key={`${x.feature_key || x.feature}-${i}`}><div><span>{x.feature}</span><b className={x.direction}>{x.direction==='risk'?'+':'−'}{Math.abs(Number(x.effect||0)).toFixed(2)}</b></div><div className="factor-bar"><i className={x.direction} style={{width:`${Math.min(100,Math.max(10,Math.abs(Number(x.effect||0))*30))}%`}} /></div><small>Observed value: {x.value}</small></div>) : <EmptyState text="No contributor data returned." />}
            </div>
          </div>
          <div><div className="section-kicker" style={{marginBottom:8}}>AI STACK</div><div className="safeguard-grid">
            <Safeguard t="Prediction" v="XGBoost + RF" /><Safeguard t="Burnout" v={model.burnout_model || 'Gradient Boosting'} /><Safeguard t="Anomaly" v="Isolation Forest" /><Safeguard t="Explainability" v="SHAP" /><Safeguard t="Decision" v="Human review" />
          </div></div>
        </div>
      </div>
    </div>
  </Panel>;
}

function AIScore({ label, value }) { return <div style={{border:'1px solid rgba(42,67,101,0.65)',borderRadius:12,padding:'10px 12px',background:'rgba(255,255,255,0.025)'}}><span className="t-xs" style={{color:'var(--outline-variant)'}}>{label}</span><strong style={{display:'block',marginTop:4,fontSize:18}}>{value}</strong></div>; }

function Cases({ casesData, openCase, selectedCase, caseState, reviewSelectedCase, loadingAction, runRisk }) {
  const cases = casesData.length ? casesData : [
    { case_id: 'WF-00041', risk_score: 72, risk_tier: 'INTERVENTION', priority: 'HIGH', driver: 'Sleep disruption · workload · deployment', trajectory: 'Deteriorating', status: 'UNDER REVIEW' },
    { case_id: 'WF-00052', risk_score: 84, risk_tier: 'URGENT', priority: 'URGENT', driver: 'Mood trajectory · overtime · deployment', trajectory: 'Deteriorating', status: 'UNDER REVIEW' },
    { case_id: 'WF-00067', risk_score: 47, risk_tier: 'WATCH', priority: 'LOW', driver: 'Leave recovery · workload', trajectory: 'Stable', status: 'MONITOR' },
  ];

  return <>
    <div className="page-intro"><div><span className="section-kicker">WELFARE CASE MANAGEMENT</span><h2>Human-led intervention queue.</h2><p>AI identifies signals. Authorized welfare personnel decide what happens next.</p></div><button className="secondary" onClick={runRisk} disabled={loadingAction}>Refresh intelligence</button></div>
    <Panel title={`Priority cases · ${cases.length}`}>
      <div className="table-wrap"><table><thead><tr><th>Case</th><th>Risk</th><th>Tier</th><th>Primary pattern</th><th>Trend</th><th>Status</th><th /></tr></thead><tbody>{cases.map((c, index) => <tr key={c.case_id || c.id || index}><td className="mono">{c.case_id || c.id}</td><td><strong>{c.risk_score ?? c.risk ?? '—'}</strong>/100</td><td><span className={`tag ${tierClass(c.priority || c.tier)}`}>{c.priority || c.tier || 'REVIEW'}</span></td><td>{c.driver || (c.primary_factors || []).slice(0, 3).join(' · ')}</td><td className={String(c.trajectory || '').toLowerCase().includes('deterior') ? 'trend-up' : ''}>{c.trajectory === 'Deteriorating' ? '↑' : c.trajectory === 'Recovering' ? '↓' : '→'}</td><td>{c.status || 'OPEN'}</td><td><button className="text-button" onClick={() => openCase(c)}>Open</button></td></tr>)}</tbody></table></div>
    </Panel>

    <div className="grid-2">
      <Panel title="Human review state">
        <div className="notice"><strong>{selectedCase?.case_id || 'No case selected'}</strong>{selectedCase ? ` · ${selectedCase.status}` : ' · Open a case above to inspect evidence.'}</div>
        <ReviewStep n="01" title="Risk detected" done={!!selectedCase} />
        <ReviewStep n="02" title="Evidence + explanation" done={!!selectedCase} />
        <ReviewStep n="03" title="Welfare recommendation" done={!!selectedCase} />
        <ReviewStep n="04" title="Officer decision" done={['REVIEWED','MODIFIED','ON HOLD','INTERVENTION','FOLLOW-UP COMPLETE'].includes(String(caseState || '').toUpperCase())} />
        <div className="panel-actions panel-actions-wrap"><button className="primary" onClick={() => reviewSelectedCase('APPROVE')} disabled={!selectedCase || loadingAction}>Approve review</button><button className="secondary" onClick={() => reviewSelectedCase('MODIFY')} disabled={!selectedCase || loadingAction}>Modify</button><button className="secondary" onClick={() => reviewSelectedCase('HOLD')} disabled={!selectedCase || loadingAction}>Hold</button></div>
      </Panel>
      <Panel title="Safeguards enforced in the workflow">
        <div className="safeguard-grid"><Safeguard t="Diagnosis" v="Never" /><Safeguard t="Disciplinary use" v="Blocked" /><Safeguard t="Human approval" v="Required" /><Safeguard t="Commander detail" v="Aggregate only" /><Safeguard t="Sensitive subject" v="Pseudonymous" /></div>
      </Panel>
    </div>
  </>;
}

function WhyNow({ model, trajectoryData, selectedCase, reviewSelectedCase, loadingAction }) {
  if (!model) return <><div className="page-intro"><div><span className="section-kicker">EXPLAINABLE PREDICTIVE ANALYTICS</span><h2>Why is a case surfacing now?</h2><p>Run a live assessment or open a case from the welfare queue.</p></div></div><EmptyState text="No live prediction is loaded yet." /></>;

  const gate = model.decision_gate || {};
  const contributorRows = Array.isArray(model.contributors) ? model.contributors : [];
  return <>
    <div className="page-intro"><div><span className="section-kicker">EXPLAINABLE PREDICTIVE ANALYTICS</span><h2>Why is this case surfacing now?</h2><p>Current signals are compared with persistence, corroboration, personal baseline, and model confidence before escalation.</p>{selectedCase && <div className="tag amber inline-tag">{selectedCase.case_id} · {selectedCase.status}</div>}</div></div>
    <div className="grid-2-1">
      <Panel title="Risk decision">
        <div className="decision-card"><div className={`big-score ${scoreColorClass(model.score)}`}>{model.score}<small>/100</small></div><div><span className={`tag ${tierClass(model.tier)}`}>{model.tier}</span><h3>{model.trajectory}</h3><p>{model.recommendation}</p><div className="confidence"><span>Model confidence</span><b>{formatPercent(model.confidence)}</b><div className="bar"><i style={{ width: `${Math.min(100, Number(model.confidence) || 0)}%` }} /></div></div><div className="ai-inline-metrics"><span>Burnout <b>{model.burnout_score}/100</b></span><span>{model.burnout_tier}</span></div></div></div>
      </Panel>
      <Panel title="Evidence gate">
        <div className="quality-list"><Quality label="Evidence quality" value={formatPercent(model.evidence_quality)} ok={Number(model.evidence_quality) >= 70} /><Quality label="Signal persistence" value={`${model.persistence_score ?? '—'}/100`} ok={Number(model.persistence_score) >= 55} /><Quality label="Corroboration" value={`${model.corroboration_score ?? '—'}/100`} ok={Number(model.corroboration_score) >= 55} /><Quality label="Personal baseline" value={gate.personal_baseline ? 'AVAILABLE' : 'LIMITED'} ok={gate.personal_baseline} /><Quality label="Safe to escalate" value={model.safe_to_escalate ? 'YES' : 'NO'} ok={model.safe_to_escalate} /></div>
      </Panel>
    </div>
    <Panel title="Why now · contributing factors">
      {contributorRows.length ? <div className="factor-grid">{contributorRows.map((x, index) => <div className="factor" key={`${x.feature_key || x.feature}-${index}`}><div><span>{x.feature}</span><b className={x.direction}>{x.direction === 'risk' ? '+' : '−'}{Math.abs(Number(x.effect || 0)).toFixed(2)}</b></div><div className="factor-bar"><i className={x.direction} style={{ width: `${Math.min(100, Math.max(8, Math.abs(Number(x.effect || 0)) * 28))}%` }} /></div><small>Current value: {x.value}</small></div>)}</div> : <EmptyState text="No factor attribution returned by the current model bundle." />}
    </Panel>
    {trajectoryData && <Panel title="Model-informed trajectory"><TrendChart data={[trajectoryData.current, trajectoryData.days7, trajectoryData.days14, trajectoryData.days30]} labels={['Now','7d','14d','30d']} /></Panel>}
    {selectedCase && <div className="panel-actions panel-actions-wrap"><button className="primary" onClick={() => reviewSelectedCase('APPROVE')} disabled={loadingAction}>Approve welfare review</button><button className="secondary" onClick={() => reviewSelectedCase('MODIFY')} disabled={loadingAction}>Modify</button><button className="secondary" onClick={() => reviewSelectedCase('HOLD')} disabled={loadingAction}>Hold</button></div>}
    <div className="notice"><strong>AI boundary:</strong> Predictive welfare decision support only. This output is not a diagnosis, disciplinary classification, or guaranteed outcome prediction.</div>
  </>;
}

function Intervention({ model, scenario, setScenario, scenarioResult, runScenario, selectedCase, recordIntervention, finishFollowUp, loadingAction }) {
  const before = scenarioResult?.before ?? model?.score ?? 0;
  const after = scenarioResult?.after ?? null;
  const recommendation = model?.recommendation || 'Welfare officer review recommended based on current evidence.';
  return <>
    <div className="page-intro"><div><span className="section-kicker">WELFARE INTERVENTION RECOMMENDATION</span><h2>Turn evidence into a support plan.</h2><p>Compare potential welfare actions, then record the authorized human decision and follow-up.</p></div><button className="secondary" onClick={() => recordIntervention({ intervention_type: 'Welfare officer check-in', notes: recommendation })} disabled={!selectedCase || loadingAction}>Record intervention</button></div>
    <div className="grid-2">
      <Panel title="Scenario controls"><Slider label="Workload reduction" value={scenario.workloadReduction} max={50} unit="%" onChange={v => setScenario({ ...scenario, workloadReduction: v })} /><Slider label="Recovery days" value={scenario.recoveryDays} max={14} unit=" days" onChange={v => setScenario({ ...scenario, recoveryDays: v })} /><label className="toggle-row"><span>Counselling pathway<small>Optional support pathway for scenario modelling.</small></span><input type="checkbox" checked={scenario.counselling} onChange={e => setScenario({ ...scenario, counselling: e.target.checked })} /></label><button className="primary full" onClick={runScenario} disabled={loadingAction}>Simulate support scenario</button><div className="simulation-note">Scenario outputs are model-informed comparisons, not promises of individual response.</div></Panel>
      <Panel title="Scenario result"><div className="scenario-score"><div><span>Baseline risk</span><strong>{before || '—'}</strong></div><div className="arrow-large">→</div><div><span>Scenario risk</span><strong>{after == null ? '—' : after}</strong></div><div className="delta"><span>Delta</span><strong>{scenarioResult ? `−${scenarioResult.delta}` : '—'}</strong></div></div>{scenarioResult && <div className="route-box"><span className="section-kicker">ROUTE</span><strong>{scenarioResult.tier}</strong><p>{scenarioResult.assumptions}</p></div>}</Panel>
    </div>
    <Panel title="Suggested welfare plan"><Action text="Contact personnel through the authorized welfare channel." /><Action text="Review workload, overtime, and leave recovery opportunity." /><Action text="Offer voluntary counselling or peer support where appropriate." /><Action text="Schedule a follow-up and record the outcome." /></Panel>
    <div className="panel-actions panel-actions-wrap"><button className="primary" onClick={() => recordIntervention({ intervention_type: 'Workload + recovery support', notes: `Scenario reviewed. ${recommendation}` })} disabled={!selectedCase || loadingAction}>Record support plan</button><button className="secondary" onClick={finishFollowUp} disabled={!selectedCase || loadingAction}>Complete follow-up</button></div>
    {!selectedCase && <div className="notice"><strong>Next step:</strong> Open a welfare case from the Cases or Alerts page, then return here to record the actual intervention.</div>}
  </>;
}

function Alerts({ alertsData, handleAlertReview, loadingAction }) {
  return <>
    <div className="page-intro"><div><span className="section-kicker">AUTOMATED WELFARE ALERTS</span><h2>Review, acknowledge, act.</h2><p>Alerts are generated from the configured welfare evidence gate and routed to authorized welfare personnel.</p></div></div>
    <Panel title={`Welfare alert queue · ${alertsData.length}`}>
      <div className="alert-list">{alertsData.length ? alertsData.map((a, i) => <Alert key={a.alert_id || a.id || i} severity={a.severity || a.tier} title={a.title || `${a.case_id} · welfare review`} detail={a.detail || 'Welfare review required'} status={a.status} onReview={() => handleAlertReview(a)} disabled={loadingAction} />) : <EmptyState text="No active alerts in the demo store." />}</div>
    </Panel>
    <div className="grid-2"><Panel title="Alert safeguards"><Action text="Evidence quality + persistence checks" /><Action text="Role-based welfare routing" /><Action text="Human review before intervention" /><Action text="Audit event on alert review" /></Panel><Panel title="Alert language"><div className="notice"><strong>Use:</strong> Alerts are welfare recommendations, not diagnoses or disciplinary findings. False-positive protection and human review remain explicit system constraints.</div></Panel></div>
  </>;
}

function HRMS({ hr, loadHrms, loadingAction }) {
  return <><div className="page-intro"><div><span className="section-kicker">INTEGRATION CONTRACT</span><h2>Secure HRMS adapter.</h2><p>Demonstration interface for deployment, duty, leave, transfers, training and workload indicators.</p></div><button className="primary" onClick={loadHrms} disabled={loadingAction}>{loadingAction ? 'Fetching…' : 'Fetch mock HRMS record'}</button></div>{!hr ? <EmptyState text="Load the mock adapter to show the HR inputs used by the predictive engine." /> : <Panel title="Authorized source record"><div className="hr-grid">{Object.entries(hr).filter(([k]) => !['token','data_source'].includes(k)).map(([k,v]) => <div className="hr-item" key={k}><span>{humanize(k)}</span><strong>{String(v)}</strong></div>)}</div><div className="notice"><strong>Source:</strong> {hr.data_source}</div></Panel>}</>;
}

function Audit({ auditData }) {
  return <><div className="page-intro"><div><span className="section-kicker">AUDITABILITY</span><h2>Every sensitive action leaves a trace.</h2><p>Append-only events support privacy review and accountable human intervention.</p></div></div><Panel title="Recent activity"><div className="audit-list">{auditData.length ? auditData.map((e, i) => <div className="audit-row" key={i}><span>{formatDate(e.ts)}</span><strong>{e.event}</strong><span>{e.role}</span><code>{e.subject_hash || '—'}</code></div>) : <EmptyState text="No audit events loaded yet. Run an assessment or open a case, then revisit Audit." />}</div></Panel></>;
}

function CommanderOverview({ welfareSummaryData, runRisk, loadingIntelligence }) {
  const aggregate = welfareSummaryData?.aggregate || {};
  return <><div className="page-intro"><div><span className="section-kicker">FORCE WELFARE INTELLIGENCE</span><h2>Aggregate welfare, not private cases.</h2><p>Leadership sees unit-level pressure and resource signals without individual wellness detail.</p></div><button className="secondary" onClick={runRisk} disabled={loadingIntelligence}>Refresh aggregate view</button></div><div className="metric-grid"><Metric label="Personnel covered" value={welfareSummaryData?.personnel_covered ?? '1,284'} note="Aggregate population" /><Metric label="Welfare index" value={aggregate.welfare_index ?? 72} note="30-day composite" accent="amber" /><Metric label="Workload pressure" value={aggregate.workload_pressure ?? 64} note="Aggregate signal" accent="amber" /><Metric label="Resource gap" value={aggregate.resource_gap ?? 11} note="Units requiring attention" accent="red" /></div><div className="privacy-lock"><strong>Privacy boundary</strong><span>Individual risk scores, SHAP factors and personnel identities are not displayed in this role.</span></div><div className="grid-2"><Panel title="Organizational signals"><Pattern title="Leave utilization" detail="Recovery opportunity is below the current unit baseline." severity="MODERATE" /><Pattern title="Deployment pressure" detail="Extended deployment concentration is elevated." severity="HIGH" /><Pattern title="Duty load" detail="Aggregate overtime is increasing across the current cycle." severity="MODERATE" /></Panel><Panel title="Recommended organizational actions"><Action text="Review leave backlog before the next deployment rotation." /><Action text="Review overtime concentration by unit." /><Action text="Increase welfare outreach during extended deployments." /></Panel></div></>;
}

function CommanderWorkload() { return <><div className="page-intro"><div><span className="section-kicker">WORKLOAD BALANCING</span><h2>Find pressure before it becomes a welfare event.</h2><p>Aggregate duty, deployment and leave indicators can guide workload balancing without exposing individual cases.</p></div></div><Panel title="Unit workload profile"><div className="workload-grid"><Workload label="North Sector" value={78} /><Workload label="Central Sector" value={61} /><Workload label="South Sector" value={49} /><Workload label="Training Wing" value={58} /></div></Panel><Panel title="Operational guardrail"><div className="notice"><strong>Commander views are aggregate-only.</strong> Individual wellness assessments remain restricted to authorized welfare workflows.</div></Panel></>;
}

function CommanderReports({ welfareSummaryData }) {
  const aggregate = welfareSummaryData?.aggregate || {};
  return <><div className="page-intro"><div><span className="section-kicker">WELFARE REPORTING</span><h2>Decision-ready summaries.</h2><p>Aggregate welfare indicators provide evidence for resource and workload planning.</p></div></div><div className="report-card"><div><span>30-day welfare index</span><strong>{aggregate.welfare_index ?? 72}</strong></div><div><span>Workload pressure</span><strong>{aggregate.workload_pressure ?? 64}</strong></div><div><span>Privacy status</span><strong>Aggregate-only</strong></div></div><Panel title="Report interpretation"><Action text="Use trend changes to target welfare resources." /><Action text="Review unit workload concentration before rotation changes." /><Action text="Keep individual case data outside the command reporting surface." /></Panel></>;
}

function PersonnelHome() { return <><div className="person-hero"><div><span className="section-kicker">PRIVATE WELLBEING SPACE</span><h2>Good to see you.</h2><p>Your information supports welfare only. Optional data stays under your consent controls.</p></div><div className="wellbeing-ring"><strong>74</strong><span>wellbeing</span></div></div><div className="grid-2"><Panel title="Recent trend"><TrendChart data={[66,68,69,71,72,74]} labels={['-5d','-4d','-3d','-2d','-1d','Now']} /></Panel><Panel title="Today"><div className="pulse-summary"><div><span>Sleep</span><strong>7h 02m</strong></div><div><span>Energy</span><strong>Good</strong></div><div><span>Support path</span><strong>Available</strong></div><div><span>Next pulse</span><strong>Evening</strong></div></div></Panel></div><Panel title="Available support"><Action text="Complete a private wellness check-in." /><Action text="Review your wellbeing trend." /><Action text="Open privacy and consent settings." /></Panel></>; }

function DailyPulse({ pulse, setPulse, savePulse }) { return <><div className="page-intro"><div><span className="section-kicker">OPTIONAL SELF-ASSESSMENT</span><h2>Daily Pulse</h2><p>A 30-second check-in. You choose what to share.</p></div><button className="primary" onClick={savePulse}>Save check-in</button></div><div className="pulse-grid">{[['mood','How is your mood?'],['stress','How stressed do you feel?'],['fatigue','How fatigued do you feel?'],['sleep','How was your sleep?']].map(([key, question]) => <div className="pulse-card" key={key}><span>{question}</span><div className="choice-row">{[1,2,3,4,5].map(n => <button key={n} className={pulse[key] === n ? 'choice selected' : 'choice'} onClick={() => setPulse({ ...pulse, [key]: n })}>{n}</button>)}</div></div>)}</div><div className="notice"><strong>Privacy:</strong> This check-in is voluntary. It is not a diagnosis and is not automatically visible to command-level users.</div></>; }

function Assessment() { return <><div className="page-intro"><div><span className="section-kicker">WELLNESS SCREENING</span><h2>Structured assessment</h2><p>Use approved screening instruments as support signals, not as diagnosis.</p></div><button className="secondary">Start assessment</button></div><Panel title="Assessment pathway"><ReviewStep n="01" title="Consent & purpose" done /><ReviewStep n="02" title="Validated questionnaire" /><ReviewStep n="03" title="Private result" /><ReviewStep n="04" title="Support options" /></Panel></>; }

function Privacy({ consent, setConsentState, saveConsent, requestErase }) { return <><div className="page-intro"><div><span className="section-kicker">PRIVACY CENTER</span><h2>You control the visibility of your data.</h2><p>Role-based access, consent controls and auditable privacy workflows protect sensitive welfare information.</p></div></div><Panel title="Consent controls"><div className="notice"><strong>Purpose limitation:</strong> Optional self-reporting and biometric signals are used only for welfare support. Command views remain aggregate-only.</div>{Object.entries(consent).map(([key, value]) => <label className="toggle-row" key={key}><span>{humanize(key)} <small>{key === 'biometric' ? 'Optional, only where authorized' : 'Used for the configured welfare workflow'}</small></span><input type="checkbox" checked={Boolean(value)} onChange={e => { const next = { ...consent, [key]: e.target.checked }; setConsentState(next); saveConsent(next); }} /></label>)}</Panel><div className="grid-2"><Panel title="Who can see what"><Safeguard t="You" v="Personal view" /><Safeguard t="Welfare Officer" v="Authorized welfare data" /><Safeguard t="Commander" v="Aggregate only" /><Safeguard t="Administrator" v="System metadata" /></Panel><Panel title="Data principles"><Action text="Minimum necessary data" /><Action text="Pseudonymous identifiers" /><Action text="AES-256-GCM application encryption" /><Action text="Human review for intervention" /><button className="secondary full" onClick={requestErase}>Request data erasure</button></Panel></div></>; }

function Alert({ severity, title, detail, status, onReview, disabled }) { const normalized = String(status || 'OPEN').toUpperCase(); return <div className="alert-row"><span className={`tag ${tierClass(severity)}`}>{severity}</span><div><strong>{title}</strong><p>{detail}</p><small className="status-note">{normalized}</small></div><button className="text-button" onClick={onReview} disabled={disabled || normalized !== 'OPEN'}>{normalized === 'OPEN' ? 'Review' : normalized}</button></div>; }
function Panel({ title, action, children }) { return <section className="panel"><div className="panel-head"><h3>{title}</h3>{action}</div>{children}</section>; }
function Metric({ label, value, note, accent='' }) { return <div className="metric"><span>{label}</span><strong className={accent}>{value}</strong><small>{note}</small></div>; }
function Pattern({ title, detail, severity }) { return <div className="pattern"><div className="pattern-mark" /><div><strong>{title}</strong><p>{detail}</p></div><span className={`tag ${tierClass(severity)}`}>{severity}</span></div>; }
function Action({ text }) { return <div className="action-row"><span>✓</span><div>{text}</div></div>; }
function ReviewStep({ n, title, done }) { return <div className="review-step"><span className={done ? 'step-num done' : 'step-num'}>{done ? '✓' : n}</span><div><strong>{title}</strong><small>{done ? 'Completed' : 'Pending human review'}</small></div></div>; }
function Safeguard({ t, v }) { return <div className="safeguard"><span>{t}</span><strong>{v}</strong></div>; }
function Quality({ label, value, ok }) { return <div className="quality"><span>{label}</span><strong className={ok ? 'green-text' : 'red-text'}>{ok ? '✓' : '!'}</strong><b>{value}</b></div>; }
function Slider({ label, value, max, unit, onChange }) { return <div className="slider-field"><div><span>{label}</span><b>{value}{unit}</b></div><input type="range" min="0" max={max} value={value} onChange={e => onChange(Number(e.target.value))} /></div>; }
function Workload({ label, value }) { return <div className="workload"><div><span>{label}</span><b>{value}</b></div><div className="bar"><i style={{ width: `${value}%` }} /></div></div>; }
function EmptyState({ text }) { return <div className="empty"><span>◎</span><p>{text}</p></div>; }
function TrendChart({ data, labels = ['Now','7d','14d','30d'] }) { const values = Array.isArray(data) ? data.map(v => Number(v) || 0) : []; const max = Math.max(...values, 1); return <div className="trend-chart"><div className="chart-values">{values.map((v, i) => <div className="chart-point" key={i}><b>{v}</b><div className="chart-bar"><i style={{ height: `${Math.max(8, (v / max) * 100)}%` }} /></div><span>{labels[i] || `T${i + 1}`}</span></div>)}</div></div>; }
function pageTitle(role, page) { return (NAV[normalizeRole(role)] || []).find(item => item[0] === page)?.[1] || 'Workspace'; }

export default App;
