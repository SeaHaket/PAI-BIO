import { useState, useEffect, useMemo, useRef } from "react";
import FitnessDial from "./FitnessDial";
import MetricCard from "./MetricCard";
import BluetoothTelemetry from "./BluetoothTelemetry";
import { calcFitnessAge, calcBMI } from "../utils/fitnessAlgorithm";
import { parseZeppCSV } from "../utils/csvParser";

export default function Dashboard() {
  const [tab, setTab] = useState("manual");
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [history, setHistory] = useState([]);
  
  // PWA Install States
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstallBtn, setShowInstallBtn] = useState(false);

  const fileRef = useRef(null);

  // Form Biometrics State
  const [form, setForm] = useState({
    age: 32,
    sex: "male",
    pai7day: 85,
    restingHR: 62,
    sleepHours: 7.5,
    spo2: 97,
    weight: 75,
    height: 175
  });

  // Load history & register PWA install event listener
  useEffect(() => {
    // Load local history
    const saved = localStorage.getItem("pai_fitness_history");
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error(e);
      }
    }

    // Capture install prompt
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBtn(true);
    });

    window.addEventListener("appinstalled", () => {
      setShowInstallBtn(false);
      setDeferredPrompt(null);
      console.log("PAI Fitness App installed successfully!");
    });
  }, []);

  // Handle standard PWA installation
  const handlePWAInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setShowInstallBtn(false);
    }
    setDeferredPrompt(null);
  };

  const setParam = (key, value) => {
    setForm(prev => ({
      ...prev,
      [key]: value
    }));
  };

  // Memoized Calculations for High-Performance Sliders
  const bmi = useMemo(() => {
    return calcBMI(form.weight, form.height);
  }, [form.weight, form.height]);

  const result = useMemo(() => {
    return calcFitnessAge({
      age: parseFloat(form.age) || 30,
      sex: form.sex,
      pai7day: parseFloat(form.pai7day) || 0,
      restingHR: parseFloat(form.restingHR) || 70,
      sleepHours: parseFloat(form.sleepHours) || 7,
      bmi: bmi || 22,
      spo2: parseFloat(form.spo2) || 98
    });
  }, [form, bmi]);

  // Handle live heart rate streams from Bluetooth Band
  const handleLiveHR = (bpm) => {
    setParam("restingHR", bpm);
  };

  // CSV Drag-and-Drop / File selection handler
  const handleFileImport = async (e) => {
    const file = e.target.files[0] || e.dataTransfer?.files[0];
    if (!file) return;

    setImporting(true);
    setError("");

    try {
      const text = await file.text();
      const parsed = parseZeppCSV(text);
      if (!parsed) throw new Error("Format error. Please upload a valid Zepp exported CSV file.");

      setForm(prev => ({
        ...prev,
        pai7day: parsed.pai7day ? Math.round(parsed.pai7day) : prev.pai7day,
        restingHR: parsed.restingHR ? Math.round(parsed.restingHR) : prev.restingHR,
        sleepHours: parsed.sleepHours ? parsed.sleepHours : prev.sleepHours,
        spo2: parsed.spo2 ? Math.round(parsed.spo2) : prev.spo2
      }));
      setTab("manual");
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  // Save telemetry record to local history
  const logTelemetry = () => {
    const record = {
      id: Date.now(),
      date: new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      fitnessAge: result.fitnessAge,
      chronoAge: form.age,
      score: result.score
    };

    const updatedHistory = [record, ...history].slice(0, 7); // Keep last 7 logs
    setHistory(updatedHistory);
    localStorage.setItem("pai_fitness_history", JSON.stringify(updatedHistory));
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem("pai_fitness_history");
  };

  // Determine card warning statuses
  const statusColors = {
    pai: form.pai7day >= 100 ? "var(--neon-volt)" : form.pai7day >= 50 ? "var(--neon-orange)" : "var(--neon-alert)",
    sleep: form.sleepHours >= 7 && form.sleepHours <= 9 ? "var(--neon-volt)" : "var(--neon-alert)",
    hr: form.restingHR <= 55 ? "var(--neon-volt)" : form.restingHR <= 75 ? "var(--neon-cyan)" : "var(--neon-alert)",
    spo2: form.spo2 >= 95 ? "var(--neon-volt)" : form.spo2 >= 90 ? "var(--neon-orange)" : "var(--neon-alert)",
    bmi: bmi >= 18.5 && bmi <= 24.9 ? "var(--neon-volt)" : "var(--neon-orange)"
  };

  // Compute SVG Points for Futuristic Sparkline
  const sparklinePoints = useMemo(() => {
    if (history.length < 2) return "";
    const w = 400;
    const h = 50;
    const padding = 10;
    const activeW = w - padding * 2;
    const activeH = h - padding * 2;

    const scores = history.map(h => h.fitnessAge);
    const min = Math.min(...scores) - 2;
    const max = Math.max(...scores) + 2;
    const range = max - min || 1;

    return history.map((rec, i) => {
      const x = padding + (activeW * (i / (history.length - 1)));
      // Invert Y since SVGs draw top-to-bottom
      const y = padding + activeH - (activeH * ((rec.fitnessAge - min) / range));
      return `${x},${y}`;
    }).join(" ");
  }, [history]);

  return (
    <div className="app-container">
      {/* ─── Header Telemetry HUD ────────────────────────────────────────────── */}
      <header style={{ 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "center", 
        padding: "16px 0 10px", 
        borderBottom: "1px solid rgba(0, 243, 255, 0.1)",
        marginBottom: "20px"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div 
            style={{ 
              width: "36px", 
              height: "36px", 
              borderRadius: "10px", 
              background: "linear-gradient(135deg, var(--neon-volt), var(--neon-cyan))",
              display: "flex", 
              alignItems: "center", 
              justifyContent: "center",
              fontSize: "18px",
              boxShadow: "0 0 12px rgba(0, 243, 255, 0.3)"
            }}
          >
            ⚡
          </div>
          <div>
            <h1 className="tech-font" style={{ fontSize: "18px", fontWeight: "900", letterSpacing: "1px", lineHeight: "1.1", color: "#ffffff" }}>
              PAI TELEMETRY
            </h1>
            <span className="tech-caps" style={{ fontSize: "9px", color: "var(--neon-cyan)", fontWeight: "800", letterSpacing: "2px" }}>
              BIO-FITNESS HUD
            </span>
          </div>
        </div>

        {/* PWA Install Button */}
        {showInstallBtn ? (
          <button 
            className="btn-cyber-secondary" 
            style={{ 
              fontSize: "11px", 
              padding: "8px 14px", 
              borderColor: "var(--neon-volt)", 
              color: "var(--neon-volt)",
              boxShadow: "0 0 10px rgba(223, 255, 0, 0.15)"
            }}
            onClick={handlePWAInstall}
          >
            📲 INSTALL APP
          </button>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div className="radar-pulse"></div>
            <span className="tech-caps" style={{ fontSize: "9px", color: "var(--text-muted)", fontWeight: "700" }}>LIVE HUD</span>
          </div>
        )}
      </header>

      {/* ─── Main Dial / Core Telemetry Panel ─────────────────────────────────── */}
      <section className="cyber-panel animate-slideup" style={{ padding: "16px 20px 24px" }}>
        <FitnessDial 
          fitnessAge={result.fitnessAge} 
          chronoAge={form.age} 
          score={result.score} 
        />
        
        {/* Save Result Button */}
        <button 
          className="btn-cyber-primary" 
          style={{ width: "80%", margin: "16px auto 0", padding: "12px", fontSize: "14px" }}
          onClick={logTelemetry}
        >
          💾 LOG DAILY TELEMETRY
        </button>
      </section>

      {/* ─── Bluetooth live stream Link ───────────────────────────────────────── */}
      <section style={{ marginTop: "16px" }}>
        <BluetoothTelemetry age={form.age} onHeartRateUpdate={handleLiveHR} />
      </section>

      {/* ─── Tabs switcher ────────────────────────────────────────────────────── */}
      <section style={{ marginTop: "16px" }}>
        <div className="cyber-tabs">
          <button 
            className={`cyber-tab ${tab === "manual" ? "active" : ""}`}
            onClick={() => setTab("manual")}
          >
            🎛️ BIO-CONTROLS
          </button>
          <button 
            className={`cyber-tab ${tab === "import" ? "active" : ""}`}
            onClick={() => setTab("import")}
          >
            📁 IMPORT DATA
          </button>
        </div>
      </section>

      {/* ─── Manual Controls / Sliders (Interactive telemetric changes) ─────────── */}
      {tab === "manual" && (
        <section className="cyber-panel animate-slideup" style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
          
          {/* Age & Sex Row */}
          <div style={{ display: "flex", gap: "16px" }}>
            <div className="cyber-input-group" style={{ flex: 1.2 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="tech-caps cyber-label">CHRONO AGE</span>
                <span className="tech-font" style={{ fontSize: "12px", color: "var(--neon-cyan)" }}>{form.age} yr</span>
              </div>
              <input 
                type="range" 
                min="18" 
                max="90" 
                value={form.age} 
                className="cyber-slider"
                onChange={(e) => setParam("age", parseInt(e.target.value))} 
              />
            </div>
            
            <div className="cyber-input-group" style={{ flex: 0.8 }}>
              <span className="tech-caps cyber-label">SEX BIOMETRIC</span>
              <select 
                className="cyber-input" 
                value={form.sex} 
                onChange={(e) => setParam("sex", e.target.value)}
                style={{ padding: "10px", fontSize: "13px" }}
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
          </div>

          {/* PAI Slider */}
          <div className="cyber-input-group">
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="tech-caps cyber-label">PAI SCORE (7-DAY ACCUMULATED)</span>
              <span className="tech-font" style={{ fontSize: "12px", color: statusColors.pai }}>{form.pai7day}</span>
            </div>
            <input 
              type="range" 
              min="0" 
              max="150" 
              value={form.pai7day} 
              className="cyber-slider"
              onChange={(e) => setParam("pai7day", parseInt(e.target.value))} 
            />
          </div>

          {/* Resting Heart Rate Slider */}
          <div className="cyber-input-group">
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="tech-caps cyber-label">RESTING HEART RATE</span>
              <span className="tech-font" style={{ fontSize: "12px", color: statusColors.hr }}>{form.restingHR} BPM</span>
            </div>
            <input 
              type="range" 
              min="40" 
              max="110" 
              value={form.restingHR} 
              className="cyber-slider"
              onChange={(e) => setParam("restingHR", parseInt(e.target.value))} 
            />
          </div>

          {/* Sleep Hours Slider */}
          <div className="cyber-input-group">
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="tech-caps cyber-label">SLEEP DURATION</span>
              <span className="tech-font" style={{ fontSize: "12px", color: statusColors.sleep }}>{form.sleepHours} hrs</span>
            </div>
            <input 
              type="range" 
              min="4" 
              max="12" 
              step="0.5"
              value={form.sleepHours} 
              className="cyber-slider"
              onChange={(e) => setParam("sleepHours", parseFloat(e.target.value))} 
            />
          </div>

          {/* SpO2 Blood Oxygen Slider */}
          <div className="cyber-input-group">
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="tech-caps cyber-label">BLOOD OXYGEN (SPO2)</span>
              <span className="tech-font" style={{ fontSize: "12px", color: statusColors.spo2 }}>{form.spo2}%</span>
            </div>
            <input 
              type="range" 
              min="85" 
              max="100" 
              value={form.spo2} 
              className="cyber-slider"
              onChange={(e) => setParam("spo2", parseInt(e.target.value))} 
            />
          </div>

          {/* Weight & Height sliders */}
          <div style={{ display: "flex", gap: "16px" }}>
            <div className="cyber-input-group" style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="tech-caps cyber-label">WEIGHT</span>
                <span className="tech-font" style={{ fontSize: "12px", color: "var(--neon-cyan)" }}>{form.weight} kg</span>
              </div>
              <input 
                type="range" 
                min="40" 
                max="140" 
                value={form.weight} 
                className="cyber-slider"
                onChange={(e) => setParam("weight", parseInt(e.target.value))} 
              />
            </div>
            
            <div className="cyber-input-group" style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="tech-caps cyber-label">HEIGHT</span>
                <span className="tech-font" style={{ fontSize: "12px", color: "var(--neon-cyan)" }}>{form.height} cm</span>
              </div>
              <input 
                type="range" 
                min="120" 
                max="220" 
                value={form.height} 
                className="cyber-slider"
                onChange={(e) => setParam("height", parseInt(e.target.value))} 
              />
            </div>
          </div>
        </section>
      )}

      {/* ─── Import Panel ────────────────────────────────────────────────────── */}
      {tab === "import" && (
        <section className="cyber-panel animate-slideup" style={{ marginTop: "16px" }}>
          <div 
            onDragOver={handleDragOver}
            onDrop={handleFileImport}
            style={{
              border: "1px dashed var(--border-glow)",
              borderRadius: "12px",
              padding: "30px 20px",
              textAlign: "center",
              cursor: "pointer",
              backgroundColor: "rgba(8, 14, 27, 0.4)",
              transition: "border-color 0.2s"
            }}
            onClick={() => fileRef.current.click()}
          >
            <div style={{ fontSize: "36px", marginBottom: "8px" }}>📊</div>
            <h3 className="tech-caps" style={{ fontSize: "14px", color: "#ffffff", marginBottom: "6px" }}>Zepp Health Data Port</h3>
            <p style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: "1.5", maxWidth: "260px", margin: "0 auto 16px" }}>
              Drag & drop your health CSV file exported from <strong>Zepp Life</strong> here, or browse files.
            </p>
            
            <input 
              ref={fileRef} 
              type="file" 
              accept=".csv,.txt" 
              onChange={handleFileImport} 
              style={{ display: "none" }} 
            />
            
            <button 
              className="btn-cyber-secondary"
              style={{ fontSize: "12px" }}
              disabled={importing}
            >
              {importing ? "IMPORTING SCAN..." : "BROWSE DATA PATH"}
            </button>
          </div>

          {error && (
            <div style={{ color: "var(--neon-alert)", fontSize: "12px", marginTop: "12px", padding: "10px", backgroundColor: "rgba(255, 42, 95, 0.08)", borderRadius: "8px", border: "1px solid rgba(255, 42, 95, 0.15)" }}>
              ⚠️ {error}
            </div>
          )}

          {/* Mini-instructions for user */}
          <div style={{ marginTop: "20px" }}>
            <span className="tech-caps" style={{ fontSize: "10px", color: "var(--text-muted)", display: "block", marginBottom: "8px" }}>Zepp Life Export Protocol</span>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {[
                "Open Zepp Life app → Go to Profile",
                "Scroll to Settings → Export Health Data",
                "Choose date range & finalize CSV export",
                "Load file here to analyze telemetry"
              ].map((step, idx) => (
                <div key={idx} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", color: "var(--text-muted)" }}>
                  <div style={{ width: "16px", height: "16px", borderRadius: "4px", backgroundColor: "rgba(0, 243, 255, 0.08)", color: "var(--neon-cyan)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", fontWeight: "800" }}>{idx+1}</div>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ─── Real-Time Biometric Insight Grid ─────────────────────────────────── */}
      <section style={{ marginTop: "16px" }}>
        <h2 className="tech-caps" style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "8px", paddingLeft: "4px" }}>
          BIOMETRIC SYSTEM LOGS
        </h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
          <MetricCard 
            icon="🫀" 
            label="PAI Score" 
            value={form.pai7day} 
            sub="Target: 100+" 
            statusColor={statusColors.pai} 
          />
          <MetricCard 
            icon="💤" 
            label="Sleep Time" 
            value={`${form.sleepHours}h`} 
            sub="Target: 7–9h" 
            statusColor={statusColors.sleep} 
          />
          <MetricCard 
            icon="❤️" 
            label="Resting HR" 
            value={`${form.restingHR}`} 
            sub="BPM" 
            statusColor={statusColors.hr} 
          />
          <MetricCard 
            icon="🩸" 
            label="Blood Oxygen" 
            value={`${form.spo2}%`} 
            sub="Target: 95%+" 
            statusColor={statusColors.spo2} 
          />
          <MetricCard 
            icon="⚖️" 
            label="Weight Index" 
            value={`${bmi || "--"}`} 
            sub="Normal BMI: 18.5–24.9" 
            statusColor={statusColors.bmi} 
          />
        </div>
      </section>

      {/* ─── Dynamic AI Recommendation Coach ────────────────────────────────── */}
      <section className="cyber-panel animate-slideup" style={{ marginTop: "16px", borderLeft: `3px solid ${result.score >= 75 ? "var(--neon-volt)" : "var(--neon-cyan)"}` }}>
        <span className="tech-caps" style={{ fontSize: "10px", color: result.score >= 75 ? "var(--neon-volt)" : "var(--neon-cyan)", fontWeight: "800", display: "block", marginBottom: "4px" }}>
          💡 AI HEALTH DIAGNOSTICS
        </span>
        <p style={{ fontSize: "12px", color: "var(--text-primary)", lineHeight: "1.6" }}>
          {form.pai7day < 100
            ? `Your 7-day PAI score (${form.pai7day}) is below the optimal cardio protection threshold of 100. Adding approximately ${Math.ceil((100 - form.pai7day) / 7)} minutes of high-intensity heart rate work daily will reduce vascular stress and drop your fitness age.`
            : form.restingHR > 65
            ? "Excellent PAI score! To optimize recovery speed, focus on zone 2 base cardiovascular training (e.g. conversational cycling/jogging) to lower resting heart rate."
            : form.sleepHours < 7
            ? "Biometrics look strong. However, your sleep duration is below the 7-hour recovery threshold, triggering systemic inflammation. Target 7.5 hours tonight to lock in your metrics."
            : form.spo2 < 95
            ? `Biometric scan reveals mild oxygen saturation levels of ${form.spo2}%. Ensure room ventilation is optimal during sleep and monitor for breathing patterns.`
            : "Telemetry status optimal. All biometric metrics are in the elite range. Maintain 100+ PAI score weekly to sustain vascular age."}
        </p>
      </section>

      {/* ─── Telemetry History Sparkline / Records ─────────────────────────────── */}
      {history.length > 0 && (
        <section className="cyber-panel animate-slideup" style={{ marginTop: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <span className="tech-caps" style={{ fontSize: "12px", fontWeight: "700" }}>HISTORICAL TELEMETRY LOGS</span>
            <button 
              onClick={clearHistory}
              style={{ fontSize: "10px", background: "none", border: "none", color: "var(--neon-alert)", cursor: "pointer", letterSpacing: "1px" }}
              className="tech-caps"
            >
              CLEAR
            </button>
          </div>

          {/* Sparkline Graph */}
          {history.length >= 2 && (
            <div style={{ margin: "10px 0 16px", padding: "8px 0", backgroundColor: "rgba(6, 9, 19, 0.4)", borderRadius: "8px", border: "1px solid rgba(0, 243, 255, 0.05)" }}>
              <svg width="100%" height="50" viewBox="0 0 400 50" preserveAspectRatio="none" style={{ overflow: "visible" }}>
                {/* Glow definition */}
                <defs>
                  <linearGradient id="sparklineGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--neon-cyan)" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="var(--neon-cyan)" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                {/* Line Path */}
                <polyline
                  fill="none"
                  stroke="var(--neon-cyan)"
                  strokeWidth="2"
                  points={sparklinePoints}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ filter: "drop-shadow(0 0 6px var(--neon-cyan))" }}
                />
                {/* Grid baseline */}
                <line x1="0" y1="25" x2="400" y2="25" stroke="rgba(0, 243, 255, 0.05)" strokeDasharray="4 4" />
              </svg>
            </div>
          )}

          {/* History Lists */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {history.map((record) => (
              <div 
                key={record.id} 
                style={{ 
                  display: "flex", 
                  justifyContent: "space-between", 
                  alignItems: "center", 
                  padding: "8px 12px", 
                  backgroundColor: "rgba(8, 14, 27, 0.4)", 
                  borderRadius: "8px",
                  borderLeft: `3px solid ${record.fitnessAge < record.chronoAge ? "var(--neon-volt)" : "var(--neon-cyan)"}`
                }}
              >
                <div>
                  <span className="tech-font" style={{ fontSize: "13px", fontWeight: "700" }}>{record.date}</span>
                  <span style={{ fontSize: "10px", color: "var(--text-muted)", marginLeft: "10px" }}>Chrono: {record.chronoAge} yrs</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span className="tech-caps" style={{ fontSize: "10px", color: "var(--text-muted)" }}>FITNESS AGE:</span>
                  <span className="tech-font" style={{ fontSize: "14px", fontWeight: "900", color: "#ffffff" }}>{record.fitnessAge}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─── Footer HUD ──────────────────────────────────────────────────────── */}
      <footer style={{ marginTop: "24px", fontSize: "10px", color: "var(--text-muted)", textAlign: "center", lineHeight: "1.6" }}>
        PAI FITNESS TELEMETRY SYSTEM v1.2.0<br />
        Based on HUNT Fitness study telemetry models (Norway, 35 yrs, 230,000+ subjects).<br />
        Not a diagnostic medical system. Consult physician parameters.
      </footer>
    </div>
  );
}
