import { useEffect, useRef, useState } from "react";

// Xiaomi Auth Service and Characteristic UUIDs (Huami/Gadgetbridge Protocol)
const XIAOMI_AUTH_SERVICE_UUID = "0000fee1-0000-1000-8000-00805f9b34fb";
const XIAOMI_AUTH_CHAR_UUID = "00000009-0000-3512-2118-0009af100700";
const HEART_RATE_SERVICE_UUID = "heart_rate";
const HEART_RATE_CHAR_UUID = "heart_rate_measurement";

// Helper function to encrypt challenge using Web Crypto API (AES-ECB mode via zero-IV AES-CBC)
async function encryptChallenge(keyHex, challengeBytes) {
  const cleanKey = keyHex.trim().replace(/^0x/i, "");
  if (cleanKey.length !== 32) {
    throw new Error("Key length mismatch. Ensure key is exactly 32 hex characters.");
  }
  
  // Convert 32-character hex key to 16-byte Uint8Array
  const keyBytes = new Uint8Array(
    cleanKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
  );
  
  // Import key for AES-CBC
  const cryptoKey = await window.crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-CBC" },
    false,
    ["encrypt"]
  );

  // 16-byte zero IV (ensures CBC acts as ECB for a single 16-byte block)
  const iv = new Uint8Array(16);

  // Encrypt the 16-byte challenge. Output contains 16-byte block + 16-byte padding block.
  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: "AES-CBC", iv: iv },
    cryptoKey,
    challengeBytes
  );

  // Take only the first 16 bytes (discarding the padding block)
  return new Uint8Array(ciphertextBuffer.slice(0, 16));
}

export default function BluetoothTelemetry({ age, onHeartRateUpdate }) {
  const [device, setDevice] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [liveBPM, setLiveBPM] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [isSimulating, setIsSimulating] = useState(false);

  // Advanced Cryptographic Auth states
  const [useAuth, setUseAuth] = useState(false);
  const [authKey, setAuthKey] = useState("");
  const [authStatus, setAuthStatus] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const ecgPoints = useRef([]);
  const simInterval = useRef(null);
  const authCharRef = useRef(null);

  // Load saved credentials on mount
  useEffect(() => {
    const savedKey = localStorage.getItem("mi_band_auth_key");
    const savedUseAuth = localStorage.getItem("mi_band_use_auth");
    if (savedKey) setAuthKey(savedKey);
    if (savedUseAuth === "true") setUseAuth(true);

    return () => {
      stopSimulator();
      disconnectDevice();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // Save changes to local storage
  const saveAuthSettings = (key, value) => {
    if (key === "authKey") {
      setAuthKey(value);
      localStorage.setItem("mi_band_auth_key", value);
    }
    if (key === "useAuth") {
      setUseAuth(value);
      localStorage.setItem("mi_band_use_auth", value ? "true" : "false");
    }
  };

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

    if (ecgPoints.current.length === 0) {
      for (let i = 0; i < W; i++) {
        ecgPoints.current.push(H / 2);
      }
    }

    let t = 0;
    const drawECG = () => {
      ctx.fillStyle = "rgba(6, 9, 19, 0.4)";
      ctx.fillRect(0, 0, W, H);

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

      const bpmRate = liveBPM || 70;
      const bpmFactor = bpmRate / 60;
      const period = Math.floor(60 / bpmFactor);
      
      t++;
      let yOffset = 0;
      const phase = t % period;

      if (phase > 0 && phase < 4) {
        yOffset = -5;
      } else if (phase >= 4 && phase < 8) {
        yOffset = 0;
      } else if (phase === 8) {
        yOffset = 8;
      } else if (phase === 9) {
        yOffset = -35;
      } else if (phase === 10) {
        yOffset = 25;
      } else if (phase >= 11 && phase < 13) {
        yOffset = 0;
      } else if (phase >= 13 && phase < 18) {
        yOffset = -10;
      }

      ecgPoints.current.shift();
      const targetVal = (H / 2) + yOffset + (Math.sin(t / 2) * (liveBPM ? 1.2 : 0.3));
      ecgPoints.current.push(targetVal);

      ctx.beginPath();
      ctx.moveTo(0, ecgPoints.current[0]);
      for (let i = 1; i < W; i++) {
        ctx.lineTo(i, ecgPoints.current[i]);
      }
      
      const activeColor = liveBPM > 0 ? currentZone.color : "rgba(0, 243, 255, 0.4)";
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = 2;
      ctx.shadowBlur = liveBPM > 0 ? 8 : 0;
      ctx.shadowColor = activeColor;
      ctx.stroke();
      ctx.shadowBlur = 0;

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

  // ─── BLE Handlers & Cryptographic Handshake ─────────────────────────────────
  const connectDevice = async () => {
    setErrorMsg("");
    setAuthStatus("");
    setIsConnecting(true);
    stopSimulator();

    try {
      if (!navigator.bluetooth) {
        throw new Error("Web Bluetooth is not supported in this browser. Try Chrome or Edge.");
      }

      if (useAuth && authKey.trim().length !== 32) {
        throw new Error("Auth Key must be exactly 32 hexadecimal characters.");
      }

      setAuthStatus("Scanning for wearable telemetry...");
      const bluetoothDevice = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [HEART_RATE_SERVICE_UUID] },
          { namePrefix: "Mi Smart Band" },
          { namePrefix: "Mi Band" },
          { namePrefix: "Xiaomi" }
        ],
        optionalServices: [HEART_RATE_SERVICE_UUID, XIAOMI_AUTH_SERVICE_UUID, "device_information"]
      });

      setDevice(bluetoothDevice);
      bluetoothDevice.addEventListener("gattserverdisconnected", onDisconnected);

      setAuthStatus("Establishing GATT server connection...");
      const server = await bluetoothDevice.gatt.connect();

      // If user enabled custom authentication (Gadgetbridge Key)
      if (useAuth) {
        setAuthStatus("Requesting Security Authentication Service...");
        const authService = await server.getPrimaryService(XIAOMI_AUTH_SERVICE_UUID);
        const authChar = await authService.getCharacteristic(XIAOMI_AUTH_CHAR_UUID);
        authCharRef.current = authChar;

        setAuthStatus("Subscribing to Auth status ports...");
        await authChar.startNotifications();
        authChar.addEventListener("characteristicvaluechanged", handleAuthNotification);

        setAuthStatus("Requesting security token challenge...");
        // Send request challenge command: [0x01, 0x08]
        const reqChallenge = new Uint8Array([0x01, 0x08]);
        await authChar.writeValueWithResponse(reqChallenge);
        
        // Handshake will continue inside handleAuthNotification
      } else {
        // Standard Heart Rate connection
        setAuthStatus("Subscribing to heart rate telemetry...");
        const hrService = await server.getPrimaryService(HEART_RATE_SERVICE_UUID);
        const hrChar = await hrService.getCharacteristic(HEART_RATE_CHAR_UUID);

        await hrChar.startNotifications();
        hrChar.addEventListener("characteristicvaluechanged", handleHeartRateNotification);

        setIsConnected(true);
        setIsConnecting(false);
        setAuthStatus("");
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || "Connection failed. Check Bluetooth settings.");
      setIsConnecting(false);
      setIsConnected(false);
      setAuthStatus("");
    }
  };

  // Process notifications from the Auth characteristic
  const handleAuthNotification = async (event) => {
    try {
      const dataView = event.target.value;
      const data = new Uint8Array(dataView.buffer);
      console.log("Auth notification received:", Array.from(data).map(x => x.toString(16)));

      // Check header prefix
      if (data[0] !== 0x10) return;

      const responseToCmd = data[1];
      const status = data[2];

      if (responseToCmd === 0x01) {
        // Response to challenge request
        if (status === 0x01) {
          setAuthStatus("Challenge received. Computing encryption signature...");
          
          // Extrapolate the 16-byte random challenge (index 3 to 18)
          const challenge = data.slice(3, 19);
          
          // Encrypt challenge with key via AES-128 ECB
          const encrypted = await encryptChallenge(authKey, challenge);
          
          setAuthStatus("Sending encrypted response handshake...");
          // Send response command: [0x03, 0x08, ...16 encrypted bytes]
          const response = new Uint8Array(18);
          response[0] = 0x03;
          response[1] = 0x08;
          response.set(encrypted, 2);

          if (authCharRef.current) {
            await authCharRef.current.writeValueWithResponse(response);
          }
        } else {
          throw new Error("Band rejected challenge request.");
        }
      } else if (responseToCmd === 0x03) {
        // Response to sending encrypted challenge
        if (status === 0x01) {
          setAuthStatus("Pairing verified! Accessing biometrics...");
          
          // Authentication succeeded! Now hook up heart rate measurements
          const server = device.gatt;
          const hrService = await server.getPrimaryService(HEART_RATE_SERVICE_UUID);
          const hrChar = await hrService.getCharacteristic(HEART_RATE_CHAR_UUID);

          await hrChar.startNotifications();
          hrChar.addEventListener("characteristicvaluechanged", handleHeartRateNotification);

          setIsConnected(true);
          setIsConnecting(false);
          setAuthStatus("");
        } else {
          throw new Error("Band rejected auth signature. Check secret key correctness.");
        }
      }
    } catch (err) {
      console.error("Auth process error:", err);
      setErrorMsg(err.message || "Auth handshake failed.");
      disconnectDevice();
    }
  };

  const handleHeartRateNotification = (event) => {
    const value = event.target.value;
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
    setAuthStatus("");
  };

  const disconnectDevice = () => {
    if (device && device.gatt.connected) {
      device.gatt.disconnect();
    }
    setIsConnected(false);
    setLiveBPM(0);
    setDevice(null);
    setAuthStatus("");
  };

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
      <div style={{ display: "flex", alignItems: "center", justifyindex: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div className={liveBPM > 0 ? "radar-pulse" : ""} style={{ width: "10px", height: "10px", backgroundColor: liveBPM > 0 ? "var(--neon-volt)" : "var(--text-muted)", borderRadius: "50%" }}></div>
          <span className="tech-caps" style={{ fontSize: "14px", fontWeight: "700" }}>LIVE TELEMETRY LINK</span>
        </div>
        
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {!isConnected && (
            <button 
              className="btn-cyber-secondary"
              style={{ fontSize: "12px", padding: "6px 10px", minWidth: "30px", display: "flex", alignItems: "center", justifyContent: "center" }}
              onClick={() => setShowSettings(!showSettings)}
            >
              ⚙️ {showSettings ? "HIDE" : "SETTINGS"}
            </button>
          )}
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
      </div>

      {/* Advanced Settings Dropdown */}
      {showSettings && !isConnected && (
        <div 
          className="cyber-panel"
          style={{ 
            backgroundColor: "rgba(8, 14, 27, 0.75)", 
            borderColor: "rgba(0, 243, 255, 0.15)",
            padding: "14px",
            display: "flex",
            flexDirection: "column",
            gap: "10px"
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
            <input 
              type="checkbox" 
              checked={useAuth} 
              onChange={(e) => saveAuthSettings("useAuth", e.target.checked)}
              style={{ accentColor: "var(--neon-cyan)" }}
            />
            <span className="tech-caps" style={{ fontSize: "11px", color: "var(--text-primary)" }}>
              Enable Cryptographic Auth (Mi Band 4+)
            </span>
          </label>

          {useAuth && (
            <div className="cyber-input-group">
              <span className="tech-caps cyber-label">32-character Auth Key (Gadgetbridge)</span>
              <input 
                type="text" 
                className="cyber-input"
                style={{ fontSize: "12px", letterSpacing: "1px", padding: "10px" }}
                placeholder="e.g. 92a549a1bc40ff18efab5018e6ff051b"
                value={authKey}
                onChange={(e) => saveAuthSettings("authKey", e.target.value)}
                maxLength={32}
              />
              <span style={{ fontSize: "9px", color: "var(--text-muted)", lineHeight: "1.3", marginTop: "2px" }}>
                💡 Key is required because modern Mi Bands block heart rate requests unless authenticated with a cryptographic handshake. Key is saved locally in browser storage.
              </span>
            </div>
          )}
        </div>
      )}

      {/* ECG Monitor Screen */}
      <div style={{ position: "relative", borderRadius: "10px", overflow: "hidden", border: "1px solid rgba(0, 243, 255, 0.1)" }}>
        <canvas ref={canvasRef} width={400} height={100} style={{ width: "100%", height: "100px", display: "block", backgroundColor: "var(--bg-deep)" }} />
        
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
          <div style={{ 
            position: "absolute", 
            top: 0, 
            left: 0, 
            width: "100%", 
            height: "100%", 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center", 
            backgroundColor: "rgba(6, 9, 19, 0.75)", 
            flexDirection: "column", 
            gap: "6px",
            textAlign: "center"
          }}>
            <span className="tech-caps" style={{ fontSize: "11px", color: "var(--text-muted)" }}>
              {authStatus ? "AUTHENTICATING..." : "BIOMETRIC LINK OFFLINE"}
            </span>
            <span style={{ fontSize: "10px", color: "rgba(255, 255, 255, 0.35)", padding: "0 10px" }}>
              {authStatus || "Ready for telemetry connection"}
            </span>
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
            {isConnecting ? "LINKING..." : "⚡ CONNECT WEARABLE"}
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
          ⚠️ {errorMsg}
        </div>
      )}

      {!isConnected && !useAuth && (
        <p style={{ fontSize: "10px", color: "var(--text-muted)", textAlign: "center", lineHeight: "1.4" }}>
          💡 If connecting fails, click <strong>SETTINGS</strong> above to enable cryptographic key pairing.
        </p>
      )}
    </div>
  );
}
