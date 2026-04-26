import React, { useEffect, useMemo, useState } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";

const STORAGE_KEY = "gigzo-frontend-state-v1";

const PLAN_CATALOG = [
  {
    id: "swift-shield",
    name: "Swift Shield",
    monthlyPremium: 349,
    baseCoverage: 6000,
    defaultThresholds: { rainfall: 80, aqi: 220, traffic: 75, emergency: 65 },
    payoutMultiplier: 1,
  },
  {
    id: "urban-safeguard",
    name: "Urban Safeguard",
    monthlyPremium: 499,
    baseCoverage: 10000,
    defaultThresholds: { rainfall: 70, aqi: 190, traffic: 65, emergency: 58 },
    payoutMultiplier: 1.25,
  },
  {
    id: "max-resilience",
    name: "Max Resilience",
    monthlyPremium: 699,
    baseCoverage: 16000,
    defaultThresholds: { rainfall: 60, aqi: 170, traffic: 55, emergency: 50 },
    payoutMultiplier: 1.5,
  },
];

const defaultState = {
  users: [
    {
      id: "demo-worker",
      name: "Demo Worker",
      email: "demo@gigzo.app",
      password: "demo123",
      phone: "9999999999",
      city: "Chandigarh",
      workType: "Delivery",
      authProvider: "password",
      payoutMethod: "UPI",
      payoutAccount: "demo@upi",
    },
  ],
  currentUserId: null,
  plansByUser: {},
  metrics: { rainfall: 52, aqi: 134, traffic: 47, emergency: 28 },
  sessionsByUser: {},
  notificationPrefsByUser: {},
  apiHealth: {
    primary: "online",
    secondary: "online",
    activeSource: "primary",
    lastFailoverAt: null,
  },
  claims: [],
  payouts: [],
  notifications: [],
};

function safeReadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    return { ...defaultState, ...JSON.parse(raw) };
  } catch {
    return defaultState;
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function createMockJwt(userId) {
  const payload = {
    sub: userId,
    role: "worker",
    exp: Date.now() + 2 * 60 * 60 * 1000,
  };
  return `mock.${btoa(JSON.stringify(payload))}.sig`;
}

function addNotification(setAppState, userId, title, detail, level = "info") {
  setAppState((prev) => ({
    ...prev,
    notifications: (() => {
      const prefs =
        prev.notificationPrefsByUser[userId] ??
        { inApp: true, push: true, sms: false, email: true };
      const channelLabels = [
        ["inApp", "In-app"],
        ["push", "Push"],
        ["sms", "SMS"],
        ["email", "Email"],
      ];
      const channels = channelLabels
        .filter(([key]) => Boolean(prefs[key]))
        .map(([, label]) => label);
      return [
        {
          id: createId("notif"),
          userId,
          title,
          detail,
          level,
          channels,
          deliveryLog: channels.map((channel) => ({
            channel,
            status: "sent",
            at: new Date().toISOString(),
          })),
          read: false,
          createdAt: new Date().toISOString(),
        },
        ...prev.notifications,
      ];
    })(),
  }));
}

function AppShell({ appState, setAppState }) {
  const navigate = useNavigate();
  const location = useLocation();
  const currentUser = appState.users.find((u) => u.id === appState.currentUserId) ?? null;
  const sessionToken = currentUser ? appState.sessionsByUser[currentUser.id] : null;
  const isAuthenticated = Boolean(currentUser && sessionToken);

  const activePlan = currentUser
    ? appState.plansByUser[currentUser.id] ?? null
    : null;

  useEffect(() => {
    if (currentUser && !sessionToken) {
      setAppState((prev) => ({ ...prev, currentUserId: null }));
    }
  }, [currentUser, sessionToken, setAppState]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  }, [appState]);

  useEffect(() => {
    const timer = setInterval(() => {
      setAppState((prev) => {
        const rainfall = clamp(prev.metrics.rainfall + (Math.random() * 24 - 12), 0, 200);
        const aqi = clamp(prev.metrics.aqi + (Math.random() * 44 - 22), 30, 500);
        const traffic = clamp(prev.metrics.traffic + (Math.random() * 28 - 14), 0, 100);
        const emergency = clamp(prev.metrics.emergency + (Math.random() * 22 - 11), 0, 100);
        return { ...prev, metrics: { rainfall, aqi, traffic, emergency } };
      });
    }, 3200);

    return () => clearInterval(timer);
  }, [setAppState]);

  useEffect(() => {
    if (!currentUser || !activePlan) return;

    const trigger =
      appState.metrics.rainfall >= activePlan.thresholds.rainfall ||
      appState.metrics.aqi >= activePlan.thresholds.aqi ||
      appState.metrics.traffic >= activePlan.thresholds.traffic ||
      appState.metrics.emergency >= activePlan.thresholds.emergency;

    if (!trigger) return;

    const hasRecentClaim = appState.claims.some((claim) => {
      if (claim.userId !== currentUser.id) return false;
      const age = Date.now() - new Date(claim.createdAt).getTime();
      return age < 3 * 60 * 1000;
    });

    if (hasRecentClaim) return;

    const severityBySignal = {
      rainfall: appState.metrics.rainfall / activePlan.thresholds.rainfall,
      aqi: appState.metrics.aqi / activePlan.thresholds.aqi,
      traffic: appState.metrics.traffic / activePlan.thresholds.traffic,
      emergency: appState.metrics.emergency / activePlan.thresholds.emergency,
    };
    const severity = Math.max(...Object.values(severityBySignal));
    const payout = Math.round(
      activePlan.coverage * activePlan.payoutMultiplier * Math.min(severity, 1.8) * 0.18
    );

    const claimId = createId("claim");
    const payoutId = createId("payout");

    setAppState((prev) => ({
      ...prev,
      claims: [
        {
          id: claimId,
          userId: currentUser.id,
          status: "paid",
          amount: payout,
          metricsSnapshot: prev.metrics,
          planName: activePlan.name,
          reason: "Parametric trigger threshold exceeded",
          createdAt: new Date().toISOString(),
        },
        ...prev.claims,
      ],
      payouts: [
        {
          id: payoutId,
          userId: currentUser.id,
          claimId,
          amount: payout,
          method: currentUser.payoutMethod || "Bank Transfer",
          accountRef: currentUser.payoutAccount || "Not set",
          status: "completed",
          createdAt: new Date().toISOString(),
        },
        ...prev.payouts,
      ],
    }));

    addNotification(
      setAppState,
      currentUser.id,
      "Trigger activated and claim auto-processed",
      `Rs. ${payout} was paid based on your ${activePlan.name} policy thresholds.`,
      "success"
    );
  }, [appState.metrics, appState.claims, currentUser, activePlan, setAppState]);

  function logout() {
    setAppState((prev) => {
      if (!currentUser) {
        return { ...prev, currentUserId: null };
      }
      const nextSessions = { ...prev.sessionsByUser };
      delete nextSessions[currentUser.id];
      return {
        ...prev,
        currentUserId: null,
        sessionsByUser: nextSessions,
      };
    });
    navigate("/login");
  }

  const unreadCount = currentUser
    ? appState.notifications.filter((n) => n.userId === currentUser.id && !n.read).length
    : 0;

  const nav = [
    ["/", "Dashboard"],
    ["/plans", "Plans"],
    ["/monitoring", "Monitoring"],
    ["/claims", "Claims"],
    ["/payouts", "Payouts"],
    ["/notifications", `Notifications (${unreadCount})`],
    ["/profile", "Profile"],
  ];

  return (
    <div className="app-root">
      <div className="bg-shape bg-a" aria-hidden="true" />
      <div className="bg-shape bg-b" aria-hidden="true" />

      <header className="topbar">
        <div>
          <p className="eyebrow">GigZo Platform</p>
          <h1>AI Parametric Insurance Console</h1>
        </div>

        {currentUser ? (
          <div className="topbar-actions">
            <p className="welcome">{currentUser.name}</p>
            <button type="button" className="ghost-btn" onClick={logout}>
              Logout
            </button>
          </div>
        ) : (
          <div className="topbar-actions">
            <Link to="/login" className="ghost-btn">
              Login
            </Link>
            <Link to="/register" className="solid-btn">
              Register
            </Link>
          </div>
        )}
      </header>

      {isAuthenticated && (
        <nav className="route-nav" aria-label="Main navigation">
          {nav.map(([path, label]) => (
            <Link
              key={path}
              className={location.pathname === path ? "route-link active" : "route-link"}
              to={path}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}

      <main className="page-card">
        <Routes>
          <Route
            path="/login"
            element={
              <AuthPage
                mode="login"
                appState={appState}
                setAppState={setAppState}
                currentUser={currentUser}
                sessionToken={sessionToken}
              />
            }
          />
          <Route
            path="/register"
            element={
              <AuthPage
                mode="register"
                appState={appState}
                setAppState={setAppState}
                currentUser={currentUser}
                sessionToken={sessionToken}
              />
            }
          />

          <Route
            path="/"
            element={
              <Protected currentUser={currentUser} sessionToken={sessionToken}>
                <Dashboard appState={appState} currentUser={currentUser} activePlan={activePlan} />
              </Protected>
            }
          />
          <Route
            path="/plans"
            element={
              <Protected currentUser={currentUser} sessionToken={sessionToken}>
                <PlansPage
                  appState={appState}
                  setAppState={setAppState}
                  currentUser={currentUser}
                  activePlan={activePlan}
                />
              </Protected>
            }
          />
          <Route
            path="/monitoring"
            element={
              <Protected currentUser={currentUser} sessionToken={sessionToken}>
                <MonitoringPage
                  appState={appState}
                  setAppState={setAppState}
                  currentUser={currentUser}
                  activePlan={activePlan}
                />
              </Protected>
            }
          />
          <Route
            path="/claims"
            element={
              <Protected currentUser={currentUser} sessionToken={sessionToken}>
                <ClaimsPage appState={appState} currentUser={currentUser} />
              </Protected>
            }
          />
          <Route
            path="/payouts"
            element={
              <Protected currentUser={currentUser} sessionToken={sessionToken}>
                <PayoutsPage appState={appState} currentUser={currentUser} />
              </Protected>
            }
          />
          <Route
            path="/notifications"
            element={
              <Protected currentUser={currentUser} sessionToken={sessionToken}>
                <NotificationsPage
                  appState={appState}
                  setAppState={setAppState}
                  currentUser={currentUser}
                />
              </Protected>
            }
          />
          <Route
            path="/profile"
            element={
              <Protected currentUser={currentUser} sessionToken={sessionToken}>
                <ProfilePage
                  appState={appState}
                  setAppState={setAppState}
                  currentUser={currentUser}
                />
              </Protected>
            }
          />
          <Route path="*" element={<Navigate to={isAuthenticated ? "/" : "/login"} replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Protected({ currentUser, sessionToken, children }) {
  if (!currentUser || !sessionToken) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function AuthPage({ mode, appState, setAppState, currentUser, sessionToken }) {
  const navigate = useNavigate();
  const isLogin = mode === "login";

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    phone: "",
    city: "",
    workType: "",
    payoutMethod: "UPI",
    payoutAccount: "",
  });
  const [error, setError] = useState("");

  useEffect(() => {
    if (currentUser && sessionToken) {
      navigate("/");
    }
  }, [currentUser, sessionToken, navigate]);

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function submit(event) {
    event.preventDefault();
    setError("");

    if (isLogin) {
      const user = appState.users.find(
        (u) => u.email.toLowerCase() === form.email.toLowerCase() && u.password === form.password
      );
      if (!user) {
        setError("Invalid email or password");
        return;
      }

      setAppState((prev) => ({
        ...prev,
        currentUserId: user.id,
        sessionsByUser: { ...prev.sessionsByUser, [user.id]: createMockJwt(user.id) },
      }));
      addNotification(
        setAppState,
        user.id,
        "Welcome back",
        "Live monitoring and trigger detection are active for your account."
      );
      navigate("/");
      return;
    }

    if (!form.name || !form.email || !form.password || !form.payoutAccount) {
      setError("Please fill all required fields");
      return;
    }
    const exists = appState.users.some(
      (u) => u.email.toLowerCase() === form.email.toLowerCase()
    );
    if (exists) {
      setError("An account with this email already exists");
      return;
    }

    const userId = createId("user");
    const user = {
      id: userId,
      name: form.name,
      email: form.email,
      password: form.password,
      phone: form.phone,
      city: form.city,
      workType: form.workType,
      authProvider: "password",
      payoutMethod: form.payoutMethod,
      payoutAccount: form.payoutAccount,
    };

    setAppState((prev) => ({
      ...prev,
      users: [...prev.users, user],
      currentUserId: userId,
      sessionsByUser: { ...prev.sessionsByUser, [userId]: createMockJwt(userId) },
      notificationPrefsByUser: {
        ...prev.notificationPrefsByUser,
        [userId]: { inApp: true, push: true, sms: false, email: true },
      },
    }));

    addNotification(
      setAppState,
      userId,
      "Registration complete",
      "Customize an insurance plan to activate automated claim payouts.",
      "success"
    );
    navigate("/");
  }

  function oauthLogin(provider) {
    setError("");
    const providerEmail = `${provider}.worker@gigzo.app`;
    const existingUser = appState.users.find((u) => u.email.toLowerCase() === providerEmail);

    if (existingUser) {
      setAppState((prev) => ({
        ...prev,
        currentUserId: existingUser.id,
        sessionsByUser: {
          ...prev.sessionsByUser,
          [existingUser.id]: createMockJwt(existingUser.id),
        },
      }));
      addNotification(
        setAppState,
        existingUser.id,
        "OAuth sign-in successful",
        `You signed in using ${provider}.`,
        "success"
      );
      navigate("/");
      return;
    }

    const userId = createId("oauth-user");
    const oauthUser = {
      id: userId,
      name: `${provider[0].toUpperCase()}${provider.slice(1)} Worker`,
      email: providerEmail,
      password: "oauth",
      phone: "",
      city: "",
      workType: "",
      authProvider: provider,
      payoutMethod: "UPI",
      payoutAccount: `${provider}.worker@upi`,
    };

    setAppState((prev) => ({
      ...prev,
      users: [...prev.users, oauthUser],
      currentUserId: userId,
      sessionsByUser: { ...prev.sessionsByUser, [userId]: createMockJwt(userId) },
      notificationPrefsByUser: {
        ...prev.notificationPrefsByUser,
        [userId]: { inApp: true, push: true, sms: false, email: true },
      },
    }));
    addNotification(
      setAppState,
      userId,
      "OAuth onboarding complete",
      `Account created using ${provider}. Update your profile and plan details next.`,
      "success"
    );
    navigate("/");
  }

  return (
    <section className="auth-wrap">
      <div className="auth-note">
        <p className="eyebrow">GigZo onboarding</p>
        <h2>{isLogin ? "Sign in to your dashboard" : "Create your worker account"}</h2>
        <p>
          {isLogin
            ? "Use your account credentials. You can also try demo@gigzo.app / demo123"
            : "Set your work profile and payout details. Trigger-based claims will use this profile."}
        </p>
      </div>

      <form className="auth-form" onSubmit={submit}>
        {!isLogin && (
          <label>
            Full name
            <input value={form.name} onChange={(e) => update("name", e.target.value)} />
          </label>
        )}

        <label>
          Email
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
          />
        </label>

        <label>
          Password
          <input
            type="password"
            required
            value={form.password}
            onChange={(e) => update("password", e.target.value)}
          />
        </label>

        {!isLogin && (
          <>
            <label>
              Phone
              <input value={form.phone} onChange={(e) => update("phone", e.target.value)} />
            </label>
            <label>
              City
              <input value={form.city} onChange={(e) => update("city", e.target.value)} />
            </label>
            <label>
              Work type
              <select value={form.workType} onChange={(e) => update("workType", e.target.value)}>
                <option value="">Select work type</option>
                <option value="Delivery">Delivery</option>
                <option value="Ride sharing">Ride sharing</option>
                <option value="Freelance support">Freelance support</option>
                <option value="Logistics">Logistics</option>
              </select>
            </label>
            <label>
              Payout method
              <select
                value={form.payoutMethod}
                onChange={(e) => update("payoutMethod", e.target.value)}
              >
                <option value="UPI">UPI</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Wallet">Wallet</option>
              </select>
            </label>
            <label>
              Payout account reference
              <input
                required
                value={form.payoutAccount}
                onChange={(e) => update("payoutAccount", e.target.value)}
              />
            </label>
          </>
        )}

        {error ? <p className="form-error">{error}</p> : null}

        <button type="submit" className="solid-btn full">
          {isLogin ? "Sign In" : "Create Account"}
        </button>

        {isLogin ? (
          <div className="oauth-row">
            <button type="button" className="ghost-btn full" onClick={() => oauthLogin("google")}>
              Continue with Google (OAuth demo)
            </button>
            <button type="button" className="ghost-btn full" onClick={() => oauthLogin("github")}>
              Continue with GitHub (OAuth demo)
            </button>
          </div>
        ) : null}

        <p className="switch-auth">
          {isLogin ? "No account yet?" : "Already have an account?"}{" "}
          <Link to={isLogin ? "/register" : "/login"}>
            {isLogin ? "Register" : "Sign in"}
          </Link>
        </p>
      </form>
    </section>
  );
}

function Dashboard({ appState, currentUser, activePlan }) {
  const myClaims = appState.claims.filter((c) => c.userId === currentUser.id);
  const myPayouts = appState.payouts.filter((p) => p.userId === currentUser.id);
  const totalPayout = myPayouts.reduce((sum, item) => sum + item.amount, 0);

  const indicators = [
    ["Rainfall (mm)", Math.round(appState.metrics.rainfall)],
    ["AQI", Math.round(appState.metrics.aqi)],
    ["Traffic (%)", Math.round(appState.metrics.traffic)],
    ["Emergency restriction (%)", Math.round(appState.metrics.emergency)],
  ];

  return (
    <section className="stack gap-l">
      <article className="hero-mini">
        <div>
          <p className="eyebrow">Financial protection at speed</p>
          <h2>Welcome, {currentUser.name}</h2>
          <p>
            Your account is linked to automated trigger detection. Configure thresholds in Plans
            and monitor live environmental metrics in Monitoring.
          </p>
          <p className="muted">
            Auth mode: {currentUser.authProvider === "password" ? "Email and password" : `OAuth (${currentUser.authProvider})`}
          </p>
        </div>
        <div className="badge-wrap">
          <span className={activePlan ? "status good" : "status"}>
            {activePlan ? `Active plan: ${activePlan.name}` : "No active plan"}
          </span>
        </div>
      </article>

      <div className="metric-grid">
        <article className="metric-card">
          <p>Total claims</p>
          <strong>{myClaims.length}</strong>
        </article>
        <article className="metric-card">
          <p>Total payouts</p>
          <strong>Rs. {totalPayout}</strong>
        </article>
        <article className="metric-card">
          <p>Latest payout</p>
          <strong>{myPayouts[0] ? `Rs. ${myPayouts[0].amount}` : "Rs. 0"}</strong>
        </article>
      </div>

      <article className="panel">
        <h3>Live monitoring feed</h3>
        <div className="mini-grid">
          {indicators.map(([label, value]) => (
            <div key={label} className="mini-card">
              <p>{label}</p>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

function PlansPage({ appState, setAppState, currentUser, activePlan }) {
  const [selectedPlanId, setSelectedPlanId] = useState(activePlan?.id ?? PLAN_CATALOG[0].id);
  const selectedPlan = PLAN_CATALOG.find((p) => p.id === selectedPlanId);

  const [customization, setCustomization] = useState(() => ({
    coverage: activePlan?.coverage ?? selectedPlan.baseCoverage,
    durationMonths: activePlan?.durationMonths ?? 3,
    thresholds: activePlan?.thresholds ?? selectedPlan.defaultThresholds,
  }));

  useEffect(() => {
    setCustomization({
      coverage: selectedPlan.baseCoverage,
      durationMonths: 3,
      thresholds: selectedPlan.defaultThresholds,
    });
  }, [selectedPlanId, selectedPlan]);

  function setThreshold(key, value) {
    setCustomization((prev) => ({
      ...prev,
      thresholds: { ...prev.thresholds, [key]: Number(value) },
    }));
  }

  function activatePlan() {
    const finalPlan = {
      id: selectedPlan.id,
      name: selectedPlan.name,
      monthlyPremium: selectedPlan.monthlyPremium,
      payoutMultiplier: selectedPlan.payoutMultiplier,
      coverage: Number(customization.coverage),
      durationMonths: Number(customization.durationMonths),
      thresholds: customization.thresholds,
      activatedAt: new Date().toISOString(),
    };

    setAppState((prev) => ({
      ...prev,
      plansByUser: { ...prev.plansByUser, [currentUser.id]: finalPlan },
    }));

    addNotification(
      setAppState,
      currentUser.id,
      "Plan activated",
      `${finalPlan.name} is active with Rs. ${finalPlan.coverage} coverage.`,
      "success"
    );
  }

  return (
    <section className="stack gap-l">
      <header>
        <p className="eyebrow">Plan module</p>
        <h2>Insurance selection and customization</h2>
      </header>

      <div className="plan-grid">
        {PLAN_CATALOG.map((plan) => (
          <article key={plan.id} className={selectedPlanId === plan.id ? "plan-card selected" : "plan-card"}>
            <h3>{plan.name}</h3>
            <p>Premium: Rs. {plan.monthlyPremium}/month</p>
            <p>Base coverage: Rs. {plan.baseCoverage}</p>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => setSelectedPlanId(plan.id)}
            >
              Customize
            </button>
          </article>
        ))}
      </div>

      <article className="panel">
        <h3>Customize selected plan</h3>
        <div className="form-grid">
          <label>
            Coverage amount (Rs.)
            <input
              type="number"
              min="2000"
              step="500"
              value={customization.coverage}
              onChange={(e) =>
                setCustomization((prev) => ({ ...prev, coverage: e.target.value }))
              }
            />
          </label>
          <label>
            Duration (months)
            <input
              type="number"
              min="1"
              max="24"
              value={customization.durationMonths}
              onChange={(e) =>
                setCustomization((prev) => ({ ...prev, durationMonths: e.target.value }))
              }
            />
          </label>
          <label>
            Rainfall trigger (mm)
            <input
              type="number"
              min="20"
              max="180"
              value={customization.thresholds.rainfall}
              onChange={(e) => setThreshold("rainfall", e.target.value)}
            />
          </label>
          <label>
            AQI trigger
            <input
              type="number"
              min="80"
              max="400"
              value={customization.thresholds.aqi}
              onChange={(e) => setThreshold("aqi", e.target.value)}
            />
          </label>
          <label>
            Traffic trigger (%)
            <input
              type="number"
              min="20"
              max="95"
              value={customization.thresholds.traffic}
              onChange={(e) => setThreshold("traffic", e.target.value)}
            />
          </label>
          <label>
            Emergency restriction trigger (%)
            <input
              type="number"
              min="10"
              max="95"
              value={customization.thresholds.emergency}
              onChange={(e) => setThreshold("emergency", e.target.value)}
            />
          </label>
        </div>

        <div className="inline-actions">
          <button type="button" className="solid-btn" onClick={activatePlan}>
            Activate plan
          </button>
          {activePlan ? <p className="muted">Current active plan: {activePlan.name}</p> : null}
        </div>
      </article>
    </section>
  );
}

function MonitoringPage({ appState, setAppState, currentUser, activePlan }) {
  const metrics = appState.metrics;

  function setMetric(key, value) {
    setAppState((prev) => ({
      ...prev,
      metrics: { ...prev.metrics, [key]: Number(value) },
    }));
  }

  const rows = [
    ["rainfall", "Rainfall (mm)", 0, 200],
    ["aqi", "Air Quality Index", 0, 500],
    ["traffic", "Traffic congestion (%)", 0, 100],
    ["emergency", "Emergency restriction (%)", 0, 100],
  ];

  function simulateFailover() {
    setAppState((prev) => {
      const activeSource = prev.apiHealth.activeSource === "primary" ? "secondary" : "primary";
      return {
        ...prev,
        apiHealth: {
          ...prev.apiHealth,
          activeSource,
          primary: activeSource === "primary" ? "online" : "degraded",
          secondary: activeSource === "secondary" ? "online" : "standby",
          lastFailoverAt: new Date().toISOString(),
        },
      };
    });

    addNotification(
      setAppState,
      currentUser.id,
      "API failover executed",
      "Monitoring switched data source to maintain continuity during simulated API disruption.",
      "info"
    );
  }

  return (
    <section className="stack gap-l">
      <header>
        <p className="eyebrow">API monitoring module</p>
        <h2>Live data stream and trigger checks</h2>
      </header>

      <article className="panel">
        <h3>Current metrics</h3>
        <div className="monitor-grid">
          {rows.map(([key, label, min, max]) => (
            <div className="monitor-item" key={key}>
              <label>{label}</label>
              <input
                type="range"
                min={min}
                max={max}
                value={Math.round(metrics[key])}
                onChange={(e) => setMetric(key, e.target.value)}
              />
              <strong>{Math.round(metrics[key])}</strong>
              {activePlan ? (
                <p className={metrics[key] >= activePlan.thresholds[key] ? "danger" : "safe"}>
                  Threshold {activePlan.thresholds[key]} {metrics[key] >= activePlan.thresholds[key] ? "exceeded" : "normal"}
                </p>
              ) : (
                <p className="muted">Activate a plan to enable trigger automation</p>
              )}
            </div>
          ))}
        </div>
      </article>

      <article className="panel">
        <h3>Trigger engine status</h3>
        {!activePlan ? (
          <p>No active plan for {currentUser.name}. Set thresholds from Plans.</p>
        ) : (
          <p>
            Trigger logic evaluates every incoming metric update. If any signal crosses its
            configured threshold, claim initiation and payout are automated.
          </p>
        )}
      </article>

      <article className="panel">
        <div className="row-between">
          <h3>API reliability and failover</h3>
          <button type="button" className="ghost-btn" onClick={simulateFailover}>
            Simulate API outage failover
          </button>
        </div>
        <div className="mini-grid">
          <p>Primary feed: {appState.apiHealth.primary}</p>
          <p>Secondary feed: {appState.apiHealth.secondary}</p>
          <p>Active source: {appState.apiHealth.activeSource}</p>
        </div>
        {appState.apiHealth.lastFailoverAt ? (
          <p className="muted">Last failover: {new Date(appState.apiHealth.lastFailoverAt).toLocaleString()}</p>
        ) : null}
      </article>
    </section>
  );
}

function ClaimsPage({ appState, currentUser }) {
  const myClaims = appState.claims.filter((c) => c.userId === currentUser.id);

  return (
    <section className="stack gap-l">
      <header>
        <p className="eyebrow">Claim automation module</p>
        <h2>Claim status and event history</h2>
      </header>

      {myClaims.length === 0 ? (
        <article className="panel">
          <p>No claims generated yet. Monitoring will auto-initiate claims when thresholds are breached.</p>
        </article>
      ) : (
        <div className="list-stack">
          {myClaims.map((claim) => (
            <article key={claim.id} className="list-card">
              <div className="row-between">
                <h3>{claim.planName}</h3>
                <span className="status good">{claim.status}</span>
              </div>
              <p>{claim.reason}</p>
              <p>Amount: Rs. {claim.amount}</p>
              <p>
                Snapshot - Rain: {Math.round(claim.metricsSnapshot.rainfall)} | AQI: {Math.round(claim.metricsSnapshot.aqi)} |
                Traffic: {Math.round(claim.metricsSnapshot.traffic)} | Emergency: {Math.round(claim.metricsSnapshot.emergency)}
              </p>
              <p className="muted">{new Date(claim.createdAt).toLocaleString()}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function PayoutsPage({ appState, currentUser }) {
  const myPayouts = appState.payouts.filter((p) => p.userId === currentUser.id);
  const total = myPayouts.reduce((sum, payout) => sum + payout.amount, 0);

  return (
    <section className="stack gap-l">
      <header>
        <p className="eyebrow">Payout module</p>
        <h2>Payout transactions</h2>
      </header>

      <article className="panel">
        <h3>Total received</h3>
        <p className="big-value">Rs. {total}</p>
      </article>

      <div className="list-stack">
        {myPayouts.length === 0 ? (
          <article className="list-card">
            <p>No payouts yet.</p>
          </article>
        ) : (
          myPayouts.map((payout) => (
            <article key={payout.id} className="list-card">
              <div className="row-between">
                <h3>Claim ref: {payout.claimId}</h3>
                <span className="status good">{payout.status}</span>
              </div>
              <p>Amount: Rs. {payout.amount}</p>
              <p>Method: {payout.method}</p>
              <p>Account: {payout.accountRef}</p>
              <p className="muted">{new Date(payout.createdAt).toLocaleString()}</p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function NotificationsPage({ appState, setAppState, currentUser }) {
  const notifications = appState.notifications.filter((n) => n.userId === currentUser.id);

  function markAllRead() {
    setAppState((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) =>
        n.userId === currentUser.id ? { ...n, read: true } : n
      ),
    }));
  }

  function clearRead() {
    setAppState((prev) => ({
      ...prev,
      notifications: prev.notifications.filter((n) => !(n.userId === currentUser.id && n.read)),
    }));
  }

  return (
    <section className="stack gap-l">
      <header className="row-between">
        <div>
          <p className="eyebrow">Notification module</p>
          <h2>Real-time alerts and updates</h2>
        </div>
        <div className="inline-actions">
          <button type="button" className="ghost-btn" onClick={markAllRead}>
            Mark all read
          </button>
          <button type="button" className="ghost-btn" onClick={clearRead}>
            Clear read
          </button>
        </div>
      </header>

      <div className="list-stack">
        {notifications.length === 0 ? (
          <article className="list-card">
            <p>No notifications yet.</p>
          </article>
        ) : (
          notifications.map((notif) => (
            <article key={notif.id} className={notif.read ? "list-card" : "list-card unread"}>
              <div className="row-between">
                <h3>{notif.title}</h3>
                <span className={notif.level === "success" ? "status good" : "status"}>
                  {notif.level}
                </span>
              </div>
              <p>{notif.detail}</p>
              <p className="muted">Channels: {(notif.channels ?? ["In-app"]).join(", ")}</p>
              {(notif.deliveryLog ?? []).length > 0 ? (
                <p className="muted">
                  Delivery: {notif.deliveryLog.map((item) => `${item.channel} ${item.status}`).join(" | ")}
                </p>
              ) : null}
              <p className="muted">{new Date(notif.createdAt).toLocaleString()}</p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function ProfilePage({ appState, setAppState, currentUser }) {
  const notificationPrefs =
    appState.notificationPrefsByUser[currentUser.id] ??
    { inApp: true, push: true, sms: false, email: true };

  const [form, setForm] = useState({
    name: currentUser.name,
    phone: currentUser.phone || "",
    city: currentUser.city || "",
    workType: currentUser.workType || "",
    payoutMethod: currentUser.payoutMethod || "UPI",
    payoutAccount: currentUser.payoutAccount || "",
    notifyInApp: notificationPrefs.inApp,
    notifyPush: notificationPrefs.push,
    notifySms: notificationPrefs.sms,
    notifyEmail: notificationPrefs.email,
  });

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function save(event) {
    event.preventDefault();
    const profileUpdates = {
      name: form.name,
      phone: form.phone,
      city: form.city,
      workType: form.workType,
      payoutMethod: form.payoutMethod,
      payoutAccount: form.payoutAccount,
    };

    setAppState((prev) => ({
      ...prev,
      users: prev.users.map((u) =>
        u.id === currentUser.id
          ? { ...u, ...profileUpdates }
          : u
      ),
      notificationPrefsByUser: {
        ...prev.notificationPrefsByUser,
        [currentUser.id]: {
          inApp: form.notifyInApp,
          push: form.notifyPush,
          sms: form.notifySms,
          email: form.notifyEmail,
        },
      },
    }));

    addNotification(
      setAppState,
      currentUser.id,
      "Profile updated",
      "Your profile and payout details were saved successfully.",
      "success"
    );
  }

  const plan = appState.plansByUser[currentUser.id] ?? null;

  return (
    <section className="stack gap-l">
      <header>
        <p className="eyebrow">User module</p>
        <h2>Profile and account configuration</h2>
      </header>

      <form className="panel form-grid" onSubmit={save}>
        <label>
          Name
          <input value={form.name} onChange={(e) => update("name", e.target.value)} />
        </label>
        <label>
          Phone
          <input value={form.phone} onChange={(e) => update("phone", e.target.value)} />
        </label>
        <label>
          City
          <input value={form.city} onChange={(e) => update("city", e.target.value)} />
        </label>
        <label>
          Work type
          <input value={form.workType} onChange={(e) => update("workType", e.target.value)} />
        </label>
        <label>
          Payout method
          <select
            value={form.payoutMethod}
            onChange={(e) => update("payoutMethod", e.target.value)}
          >
            <option value="UPI">UPI</option>
            <option value="Bank Transfer">Bank Transfer</option>
            <option value="Wallet">Wallet</option>
          </select>
        </label>
        <label>
          Payout account
          <input
            value={form.payoutAccount}
            onChange={(e) => update("payoutAccount", e.target.value)}
          />
        </label>

        <div className="check-grid">
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.notifyInApp}
              onChange={(e) => update("notifyInApp", e.target.checked)}
            />
            Enable in-app alerts
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.notifyPush}
              onChange={(e) => update("notifyPush", e.target.checked)}
            />
            Enable push alerts
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.notifySms}
              onChange={(e) => update("notifySms", e.target.checked)}
            />
            Enable SMS alerts
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.notifyEmail}
              onChange={(e) => update("notifyEmail", e.target.checked)}
            />
            Enable email alerts
          </label>
        </div>

        <button type="submit" className="solid-btn">Save profile</button>
      </form>

      <article className="panel">
        <h3>Current subscription summary</h3>
        {plan ? (
          <div className="mini-grid">
            <p>Plan: {plan.name}</p>
            <p>Coverage: Rs. {plan.coverage}</p>
            <p>Premium: Rs. {plan.monthlyPremium}/month</p>
            <p>Duration: {plan.durationMonths} months</p>
          </div>
        ) : (
          <p>No active plan yet. Visit Plans to configure one.</p>
        )}
      </article>
    </section>
  );
}

function App() {
  const [appState, setAppState] = useState(() => safeReadState());
  const stateValue = useMemo(() => appState, [appState]);

  return (
    <BrowserRouter>
      <AppShell appState={stateValue} setAppState={setAppState} />
    </BrowserRouter>
  );
}

export default App;
