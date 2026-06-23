import { useEffect, useRef, useState } from "react";

export default function BluetoothTelemetry({ age, onHeartRateUpdate }) {
  const [device, setDevice] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [liveBPM, setLiveBPM] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [isSimulating, setIsSimulating] = useState(false);

  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const ecgPoints = useRef([]);
  const simInterval = useRef(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopSimulator();
      disconnectDevice();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // Compute heart rate zones based on max HR (220 - age)
  const maxHR = 220 - (parseFloat(age) || 30);
  const zones = {
    warmup: { name: "WARM UP", minPct: 0.5, maxPct: 0.6, color: "var(--neon-cyan)" },
    fatburn: { name: "FAT BURN", minPct: 0.6, maxPct: 0.7, color: "var(--neon-volt)" },
    aerobic: { name: "AEROBIC", minPct: 0.7, maxPct: 0.85, color: "var(--neon-orange)" },
    anaerobic: { name: "ANAEROBIC", minPct: 0.85, maxPct: 1.0, color: "var(--neon-alert)" },
  };

  const getZone = (bpm) => {
    if (!bpm) return { name: "RESTING", color: "var(--text-muted)" };
    const pct = bpm / maxHR;
    if (pct < 0.5) return { name: "RESTING", color: "var(--neon-cyan)" };
    if (pct < 0.6) return zones.warmup;
    if (pct < 0.7) return zones.fatburn;
    if (pct < 0.85) return zones.aerobic;
    return zones.anaerobic;
  };

  const currentZone = getZone(liveBPM);

  // ─── Real-Time ECG Waveform Drawing ──────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;

    // Initialize points array if empty
    if (ecgPoints.current.length === 0) {
      for (let i = 0; i < W; i++) {
        ecgPoints.current.push(H / 2);
      }
    }

    let t = 0;
    const drawECG = () => {
      ctx.fillStyle = "rgba(6, 9, 19, 0.4)"; // slight clear overlay for motion trails
      ctx.fillRect(0, 0, W, H);

      // Draw oscilloscope grid lines
      ctx.strokeStyle = "rgba(0, 243, 255, 0.04)";
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 20) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (let y = 0; y < H; y += 20) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      // Generate ECG-like rhythm peak based on BPM
      const bpmRate = liveBPM || 70;
      const bpmFactor = bpmRate / 60; // beats per second
      const period = Math.floor(60 / bpmFactor); // frames per pulse cycle (approx 60fps)
      
      t++;
      let yOffset = 0;
      const phase = t % period;

      if (phase > 0 && phase < 4) {
        // P-wave (small bump)
        yOffset = -5;
      } else if (phase >= 4 && phase < 8) {
        yOffset = 0;
      } else if (phase === 8) {
        // Q-wave (dip)
        yOffset = 8;
      } else if (phase === 9) {
        // R-wave (massive spike)
        yOffset = -35;
      } else if (phase === 10) {
        // S-wave (deep dip)
        yOffset = 25;
      } else if (phase >= 11 && phase < 13) {
        yOffset = 0;
      } else if (phase >= 13 && phase < 18) {
        // T-wave (medium bump)
        yOffset = -10;
      }

      // Shift points left
      ecgPoints.current.shift();
      // Add new point with noise dampening and centering
      const targetVal = (H / 2) + yOffset + (Math.sin(t / 2) * (liveBPM ? 1.2 : 0.3));
      ecgPoints.current.push(targetVal);

      // Draw path
      ctx.beginPath();
      ctx.moveTo(0, ecgPoints.current[0]);
      for (let i = 1; i < W; i++) {
        ctx.lineTo(i, ecgPoints.current[i]);
      }
      
      // Dynamic green/volt glow for active heart rate telemetry
      const activeColor = liveBPM > 0 ? currentZone.color : "rgba(0, 243, 255, 0.4)";
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = 2;
      ctx.shadowBlur = liveBPM > 0 ? 8 : 0;
      ctx.shadowColor = activeColor;
      ctx.stroke();
      ctx.shadowBlur = 0; // Reset shadow

      // Draw telemetry scanning indicator bar
      ctx.beginPath();
      ctx.arc(W - 4, ecgPoints.current[W - 1], 4, 0, Math.PI * 2);
      ctx.fillStyle = activeColor;
      ctx.fill();

      animationRef.current = requestAnimationFrame(drawECG);
    };

    drawECG();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [liveBPM, currentZone.color]);

  // ─── BLE GATT Connection Handler ───────────────────────────────────────────
  const connectDevice = async () => {
    setErrorMsg("");
    setIsConnecting(true);
    stopSimulator();

    try {
      if (!navigator.bluetooth) {
        throw new Error("Web Bluetooth is not supported in this browser. Try Chrome, Edge, or Bluefy (on iOS).");
      }

      const bluetoothDevice = await navigator.bluetooth.requestDevice({
        filters: [{ services: ["heart_rate"] }],
        optionalServices: ["device_information"]
      });

      setDevice(bluetoothDevice);

      bluetoothDevice.addEventListener("gattserverdisconnected", onDisconnected);

      const server = await bluetoothDevice.gatt.connect();
      const service = await server.getPrimaryService("heart_rate");
      const characteristic = await service.getCharacteristic("heart_rate_measurement");

      await characteristic.startNotifications();
      characteristic.addEventListener("characteristicvaluechanged", handleHeartRateNotification);

      setIsConnected(true);
      setIsConnecting(false);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || "Failed to pair. Make sure device is nearby and discoverable.");
      setIsConnecting(false);
      setIsConnected(false);
    }
  };

  const handleHeartRateNotification = (event) => {
    const value = event.target.value;
    // Parsing Standard BLE HR Protocol
    const flags = value.getUint8(0);
    const rate16 = flags & 0x01;
    let bpm = 0;
    if (rate16) {
      bpm = value.getUint16(1, true);
    } else {
      bpm = value.getUint8(1);
    }
    setLiveBPM(bpm);
    onHeartRateUpdate(bpm);
  };

  const onDisconnected = () => {
    setIsConnected(false);
    setLiveBPM(0);
    setDevice(null);
  };

  const disconnectDevice = () => {
    if (device && device.gatt.connected) {
      device.gatt.disconnect();
    }
    setIsConnected(false);
    setLiveBPM(0);
    setDevice(null);
  };

  // ─── Biometrics Simulation Mode ──────────────────────────────────────────────
  const toggleSimulator = () => {
    if (isSimulating) {
      stopSimulator();
    } else {
      startSimulator();
    }
  };

  const startSimulator = () => {
    disconnectDevice();
    setIsSimulating(true);
    setIsConnected(true);
    setErrorMsg("");
    
    let simulatedBPM = 72;
    setLiveBPM(simulatedBPM);
    onHeartRateUpdate(simulatedBPM);

    simInterval.current = setInterval(() => {
      // Simulate heart rate rising/falling organically (like an exercise wave)
      const noise = (Math.random() - 0.5) * 4;
      simulatedBPM = Math.round(Math.max(60, Math.min(175, simulatedBPM + noise + 0.1)));
      setLiveBPM(simulatedBPM);
      onHeartRateUpdate(simulatedBPM);
    }, 1500);
  };

  const stopSimulator = () => {
    if (simInterval.current) {
      clearInterval(simInterval.current);
      simInterval.current = null;
    }
    setIsSimulating(false);
    setIsConnected(false);
    setLiveBPM(0);
  };

  return (
    <div className="cyber-panel animate-slideup" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div className={liveBPM > 0 ? "radar-pulse" : ""} style={{ width: "10px", height: "10px", backgroundColor: liveBPM > 0 ? "var(--neon-volt)" : "var(--text-muted)", borderRadius: "50%" }}></div>
          <span className="tech-caps" style={{ fontSize: "14px", fontWeight: "700" }}>LIVE TELEMETRY LINK</span>
        </div>
        {isConnected && (
          <button 
            className="btn-cyber-secondary" 
            style={{ fontSize: "11px", padding: "6px 12px", border: "1px solid var(--neon-alert)", color: "var(--neon-alert)" }}
            onClick={isSimulating ? stopSimulator : disconnectDevice}
          >
            DISCONNECT
          </button>
        )}
      </div>

      {/* ECG Monitor Screen */}
      <div style={{ position: "relative", borderRadius: "10px", overflow: "hidden", border: "1px solid rgba(0, 243, 255, 0.1)" }}>
        <canvas ref={canvasRef} width={400} height={100} style={{ width: "100%", height: "100px", display: "block", backgroundColor: "var(--bg-deep)" }} />
        
        {/* Telemetry HUD overlays */}
        {isConnected && (
          <div style={{ position: "absolute", top: "10px", right: "12px", textAlign: "right" }}>
            <div className="tech-font" style={{ fontSize: "28px", fontWeight: "900", color: "#ffffff", lineHeight: 1 }}>
              {liveBPM}
            </div>
            <div className="tech-caps" style={{ fontSize: "9px", color: currentZone.color, fontWeight: "800", marginTop: "2px", letterSpacing: "1px" }}>
              {currentZone.name}
            </div>
          </div>
        )}

        {!isConnected && (
          <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(6, 9, 19, 0.75)", flexDirection: "column", gap: "6px" }}>
            <span className="tech-caps" style={{ fontSize: "11px", color: "var(--text-muted)" }}>BIOMETRIC LINK OFFLINE</span>
            <span style={{ fontSize: "10px", color: "rgba(255, 255, 255, 0.35)" }}>Ready for telemetry connection</span>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      {!isConnected && (
        <div style={{ display: "flex", gap: "10px" }}>
          <button 
            className="btn-cyber-primary" 
            style={{ flex: 1.5, padding: "12px 14px", fontSize: "13px" }}
            onClick={connectDevice}
            disabled={isConnecting}
          >
            {isConnecting ? "LINKING DEVICE..." : "⚡ CONNECT WEARABLE"}
          </button>
          
          <button 
            className="btn-cyber-secondary" 
            style={{ flex: 1, padding: "12px 14px", fontSize: "13px", color: "var(--neon-volt)", borderColor: "var(--neon-volt)" }}
            onClick={toggleSimulator}
          >
            📊 SIMULATE
          </button>
        </div>
      )}

      {errorMsg && (
        <div style={{ 
          fontSize: "11px", 
          color: "var(--neon-alert)", 
          padding: "10px", 
          backgroundColor: "rgba(255, 42, 95, 0.1)", 
          border: "1px solid rgba(255, 42, 95, 0.2)", 
          borderRadius: "8px", 
          lineHeight: "1.4"
        }}>
          {errorMsg}
        </div>
      )}

      {/* Helper Note for Smart Bands */}
      {!isConnected && (
        <p style={{ fontSize: "10px", color: "var(--text-muted)", textAlign: "center", lineHeight: "1.4" }}>
          💡 For Mi Band 6: Ensure <strong>"Activity Sharing"</strong> (Heart Rate Sharing) is enabled in Zepp Life / Mi Fitness settings.
        </p>
      )}
    </div>
  );
}
