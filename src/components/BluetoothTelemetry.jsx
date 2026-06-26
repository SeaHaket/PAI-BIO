import { useEffect, useRef, useState } from "react";

// Xiaomi Auth Service and Characteristic UUIDs (Huami/Gadgetbridge Protocol)
const XIAOMI_AUTH_SERVICE_UUID = "0000fee1-0000-1000-8000-00805f9b34fb";
const XIAOMI_AUTH_CHAR_UUID = "00000009-0000-3512-2118-0009af100700";
const HEART_RATE_SERVICE_UUID = "heart_rate";
const HEART_RATE_CHAR_UUID = "heart_rate_measurement";

// Xiaomi FEE0 Service and Chunked Transfer Characteristic UUIDs (Mi Band 6 Protocol)
const XIAOMI_FEE0_SERVICE_UUID = "0000fee0-0000-1000-8000-00805f9b34fb";
const CHUNKED_WRITE_CHAR_UUID = "00000016-0000-3512-2118-0009af100700";
const CHUNKED_READ_CHAR_UUID = "00000017-0000-3512-2118-0009af100700";

// P-192 (secp192r1) Elliptic Curve Constants
const P192_P = (2n ** 192n) - (2n ** 64n) - 1n;
const P192_A = P192_P - 3n;
const P192_B = 0x64210519e59c80e70fa7e9ab72243049feb8deecc146b9b1n;
const P192_GX = 0x188da80eb03090f67cbf20eb43a18800f4ff0afd82ff1012n;
const P192_GY = 0x07192b95ffc8da78631011ed6b24cdd573f977a11e794811n;
const P192_N = 0xfffffffffffffffffffffffe5bfe3300e84a7f471c8483d1n;
const P192_G = [P192_GX, P192_GY];

// P-192 Math Helpers using JS BigInt
function mod(x, p) {
  let res = x % p;
  return res < 0n ? res + p : res;
}

function modInverse(a, m) {
  let m0 = m;
  let y = 0n, x = 1n;
  if (m === 1n) return 0n;
  while (a > 1n) {
    let q = a / m;
    let t = m;
    m = a % m;
    a = t;
    t = y;
    y = x - q * y;
    x = t;
  }
  if (x < 0n) x += m0;
  return x;
}

function pointAdd(P, Q) {
  if (P === null) return Q;
  if (Q === null) return P;
  
  let [x1, y1] = P;
  let [x2, y2] = Q;
  
  if (x1 === x2) {
    if (mod(y1 + y2, P192_P) === 0n) return null;
    return pointDouble(P);
  }
  
  let num = mod(y2 - y1, P192_P);
  let den = mod(x2 - x1, P192_P);
  let lambda = mod(num * modInverse(den, P192_P), P192_P);
  
  let x3 = mod(lambda * lambda - x1 - x2, P192_P);
  let y3 = mod(lambda * (x1 - x3) - y1, P192_P);
  
  return [x3, y3];
}

function pointDouble(P) {
  if (P === null) return null;
  let [x1, y1] = P;
  if (y1 === 0n) return null;
  
  let num = mod(3n * x1 * x1 + P192_A, P192_P);
  let den = mod(2n * y1, P192_P);
  let lambda = mod(num * modInverse(den, P192_P), P192_P);
  
  let x3 = mod(lambda * lambda - 2n * x1, P192_P);
  let y3 = mod(lambda * (x1 - x3) - y1, P192_P);
  
  return [x3, y3];
}

function pointMultiply(k, P) {
  let result = null;
  let addend = P;
  
  while (k > 0n) {
    if (k % 2n === 1n) {
      result = pointAdd(result, addend);
    }
    addend = pointDouble(addend);
    k = k >> 1n;
  }
  
  return result;
}

function bytesToBigInt(bytes) {
  let res = 0n;
  for (let i = 0; i < bytes.length; i++) {
    res = (res << 8n) + BigInt(bytes[i]);
  }
  return res;
}

function bigIntToBytes(num, length) {
  const bytes = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(num & 255n);
    num = num >> 8n;
  }
  return bytes;
}

function bytesToBigIntLE(bytes) {
  let res = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    res = (res << 8n) + BigInt(bytes[i]);
  }
  return res;
}

function bigIntToBytesLE(num, length) {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = Number(num & 255n);
    num = num >> 8n;
  }
  return bytes;
}

function isPointOnCurve(P) {
  if (P === null) return true;
  let [x, y] = P;
  let lhs = mod(y * y, P192_P);
  let rhs = mod(x * x * x + P192_A * x + P192_B, P192_P);
  return lhs === rhs;
}

// Helper function to convert Uint8Array to formatted Hex String
const toHex = (arr) => {
  return Array.from(arr)
    .map(x => x.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
};

// Helper function to encrypt challenge using Web Crypto API (AES-ECB mode via zero-IV AES-CBC)
async function encryptChallenge(keyHex, challengeBytes, reverseKey = false) {
  const hexMatch = keyHex.trim().replace(/^0x/i, "").match(/([a-f0-9]{32})/i);
  if (!hexMatch) {
    throw new Error("Key length mismatch. Ensure key contains a 32-character hex token.");
  }
  const cleanKey = hexMatch[1];
  
  // Convert 32-character hex key to 16-byte Uint8Array
  let keyBytes = new Uint8Array(
    cleanKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
  );
  
  if (reverseKey) {
    keyBytes.reverse();
  }
  
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

// Helper to write values robustly, checking properties or falling back on failure
async function writeCharacteristicValue(characteristic, value) {
  try {
    if (characteristic.properties.writeWithoutResponse) {
      await characteristic.writeValueWithoutResponse(value);
    } else if (characteristic.properties.write) {
      await characteristic.writeValueWithResponse(value);
    } else {
      await characteristic.writeValue(value);
    }
  } catch (err) {
    console.warn("Primary write failed, trying fallback write:", err);
    try {
      await characteristic.writeValue(value);
    } catch (fallbackErr) {
      throw new Error(err.message || err);
    }
  }
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
  const [authProtocol, setAuthProtocol] = useState("ecdh"); // "ecdh" or "legacy"
  const [showSettings, setShowSettings] = useState(false);

  // Diagnostics Console State
  const [debugLogs, setDebugLogs] = useState([]);

  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const ecgPoints = useRef([]);
  const simInterval = useRef(null);
  
  // Handshake Refs
  const authCharRef = useRef(null);
  const authAttemptRef = useRef(1);
  const deviceRef = useRef(null);
  
  const chunkedHandleRef = useRef(0);
  const reassembleBufferRef = useRef(new Uint8Array(512));
  const lastSequenceNumberRef = useRef(0);
  const reassembleBufferPointerRef = useRef(0);
  const reassembleBufferExpectedBytesRef = useRef(0);
  const prvBytesRef = useRef(null);
  const pubBytesRef = useRef(null);
  const sharedSessionKeyRef = useRef(null);
  const chunkedWriteCharRef = useRef(null);
  const chunkedReadCharRef = useRef(null);

  // Load saved credentials on mount
  useEffect(() => {
    const savedKey = localStorage.getItem("mi_band_auth_key");
    const savedUseAuth = localStorage.getItem("mi_band_use_auth");
    const savedProtocol = localStorage.getItem("mi_band_auth_protocol");
    if (savedKey) setAuthKey(savedKey);
    if (savedUseAuth === "true") setUseAuth(true);
    // Force ECDH on mount — Mi Band 6 requires it. User can still switch in UI if needed.
    setAuthProtocol("ecdh");
    localStorage.setItem("mi_band_auth_protocol", "ecdh");

    return () => {
      stopSimulator();
      disconnectDevice();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // Diagnostics Logger Helper
  const addLog = (msg) => {
    const time = new Date().toLocaleTimeString(undefined, { hour12: false });
    setDebugLogs(prev => [...prev.slice(-14), `[${time}] ${msg}`]);
  };

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
    if (key === "authProtocol") {
      setAuthProtocol(value);
      localStorage.setItem("mi_band_auth_protocol", value);
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
    setDebugLogs([]); // Clear logs for new session
    stopSimulator();

    addLog("Pairing connection initiated.");

    try {
      if (!navigator.bluetooth) {
        throw new Error("Web Bluetooth is not supported in this browser. Try Chrome or Edge.");
      }

      const hexMatch = authKey.trim().replace(/^0x/i, "").match(/([a-f0-9]{32})/i);
      if (useAuth && !hexMatch) {
        throw new Error("Could not find a valid 32-character hexadecimal key in input.");
      }

      // Read protocol fresh from localStorage to bypass any HMR stale React state
      const effectiveProtocol = localStorage.getItem("mi_band_auth_protocol") || "ecdh";
      addLog(`⚡ Auth Protocol: ${effectiveProtocol === 'ecdh' ? 'ECDH (Mi Band 6)' : 'Legacy (Mi Band 4/5)'}`);

      setAuthStatus("Scanning for wearable telemetry...");
      addLog("Scanning for BLE devices...");
      const bluetoothDevice = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [HEART_RATE_SERVICE_UUID] },
          { namePrefix: "Mi Smart Band" },
          { namePrefix: "Mi Band" },
          { namePrefix: "Xiaomi" }
        ],
        optionalServices: [HEART_RATE_SERVICE_UUID, XIAOMI_AUTH_SERVICE_UUID, XIAOMI_FEE0_SERVICE_UUID, "device_information"]
      });

      addLog(`Found device: ${bluetoothDevice.name || "Unnamed Band"}`);
      setDevice(bluetoothDevice);
      deviceRef.current = bluetoothDevice;
      bluetoothDevice.addEventListener("gattserverdisconnected", onDisconnected);

      setAuthStatus("Establishing GATT server connection...");
      addLog("Connecting to GATT Server...");
      const server = await bluetoothDevice.gatt.connect();
      addLog("GATT Connected.");

      // If user enabled custom authentication (Gadgetbridge Key)
      if (useAuth) {
        if (effectiveProtocol === "ecdh") {
          await startEcdhHandshake(server, hexMatch[1]);
        } else {
          await startLegacyHandshake(server, hexMatch[1]);
        }
      } else {
        // Standard Heart Rate connection
        await subscribeToHeartRate(server);
      }
    } catch (err) {
      console.error(err);
      addLog(`ERROR: ${err.message || err}`);
      setErrorMsg(err.message || "Connection failed. Check Bluetooth settings.");
      setIsConnecting(false);
      setIsConnected(false);
      setAuthStatus("");
    }
  };

  const startLegacyHandshake = async (server, cleanKey) => {
    authAttemptRef.current = 1; // Reset auth attempt count
    setAuthStatus("Requesting Security Authentication Service...");
    addLog(`Requesting service FEE1...`);
    const authService = await server.getPrimaryService(XIAOMI_AUTH_SERVICE_UUID);
    addLog("Service FEE1 acquired.");

    addLog(`Requesting characteristic 0009...`);
    const authChar = await authService.getCharacteristic(XIAOMI_AUTH_CHAR_UUID);
    authCharRef.current = authChar;
    addLog("Characteristic 0009 acquired.");

    setAuthStatus("Subscribing to Auth status ports...");
    addLog("Subscribing to notification descriptors...");
    await authChar.startNotifications();
    authChar.addEventListener("characteristicvaluechanged", handleLegacyAuthNotification);
    addLog("Notifications active on 0009.");

    // Step 1: Send Key to initialize auth session
    setAuthStatus("Initializing session signature...");
    
    const keyBytes = new Uint8Array(cleanKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    
    const sendKeyCmd = new Uint8Array(18);
    sendKeyCmd[0] = 0x01;
    sendKeyCmd[1] = 0x08;
    sendKeyCmd.set(keyBytes, 2);

    addLog(`TX Send Key -> ${toHex(sendKeyCmd)}`);
    await writeCharacteristicValue(authChar, sendKeyCmd);
  };

  const startEcdhHandshake = async (server, cleanKey) => {
    setAuthStatus("Requesting Security Service FEE0...");
    addLog(`Requesting service FEE0...`);
    const fee0Service = await server.getPrimaryService(XIAOMI_FEE0_SERVICE_UUID);
    addLog("Service FEE0 acquired.");

    addLog(`Requesting chunked transfer write characteristic 0016...`);
    const chunkedWriteChar = await fee0Service.getCharacteristic(CHUNKED_WRITE_CHAR_UUID);
    chunkedWriteCharRef.current = chunkedWriteChar;
    addLog("Chunked Write characteristic 0016 acquired.");

    addLog(`Requesting chunked transfer read characteristic 0017...`);
    const chunkedReadChar = await fee0Service.getCharacteristic(CHUNKED_READ_CHAR_UUID);
    chunkedReadCharRef.current = chunkedReadChar;
    addLog("Chunked Read characteristic 0017 acquired.");

    setAuthStatus("Subscribing to Chunked status ports...");
    addLog("Subscribing to notification descriptors on 0017...");
    await chunkedReadChar.startNotifications();
    chunkedReadChar.addEventListener("characteristicvaluechanged", handleEcdhAuthNotification);
    addLog("Notifications active on 0017.");

    setAuthStatus("Generating ECDH security keys...");
    addLog("Generating P-192 ECDH keys...");
    
    // Generate private key (24 random bytes in range [1, P192_N - 1])
    const prv = new Uint8Array(24);
    let prvInt = 0n;
    do {
      window.crypto.getRandomValues(prv);
      prvInt = bytesToBigInt(prv);
    } while (prvInt === 0n || prvInt >= P192_N);
    
    prvBytesRef.current = prv;
    
    // Compute public key = prv * G
    const pubPoint = pointMultiply(prvInt, P192_G);
    if (!pubPoint || !isPointOnCurve(pubPoint)) {
      throw new Error("Failed to generate a valid ECDH public key point.");
    }
    
    const [pubX, pubY] = pubPoint;
    const pubXBytes = bigIntToBytesLE(pubX, 24);
    const pubYBytes = bigIntToBytesLE(pubY, 24);
    
    const pubBytes = new Uint8Array(48);
    pubBytes.set(pubXBytes, 0);
    pubBytes.set(pubYBytes, 24);
    pubBytesRef.current = pubBytes;

    addLog(`Local Public Key: ${toHex(pubBytes)}`);

    // Reset handshake sequence/reassembly state
    chunkedHandleRef.current = 0;
    reassembleBufferPointerRef.current = 0;
    reassembleBufferExpectedBytesRef.current = 0;
    lastSequenceNumberRef.current = 0;

    // Send first auth packet: [4, 2, 0, 2, ...publicKey]
    const CHUNKED2021_ENDPOINT_AUTH = 130;
    const initialAuth = new Uint8Array(52);
    initialAuth[0] = 4;
    initialAuth[1] = 2;
    initialAuth[2] = 0;
    initialAuth[3] = 2;
    initialAuth.set(pubBytes, 4);

    const handle = chunkedHandleRef.current;
    chunkedHandleRef.current++;

    setAuthStatus("Exchanging ECDH security keys...");
    addLog("Sending first auth packet (ECDH Public Key)...");
    await writeChunkedValue(chunkedWriteChar, CHUNKED2021_ENDPOINT_AUTH, handle, initialAuth);
  };

  const writeChunkedValue = async (char, type, handle, data) => {
    let remaining = data.length;
    let count = 0;
    let header_size = 11;
    const mMTU = 23;
    while (remaining > 0) {
      const MAX_CHUNKLENGTH = mMTU - 3 - header_size;
      const copybytes = Math.min(remaining, MAX_CHUNKLENGTH);
      const chunk = new Uint8Array(copybytes + header_size);
      let flags = 0;
      if (count === 0) {
        flags |= 1;
        let i = 5;
        chunk[i++] = data.length & 255;
        chunk[i++] = (data.length >> 8) & 255;
        chunk[i++] = (data.length >> 16) & 255;
        chunk[i++] = (data.length >> 24) & 255;
        chunk[i++] = type & 255;
        chunk[i] = (type >> 8) & 255;
      }
      if (remaining <= MAX_CHUNKLENGTH) {
        flags |= 6;
      }
      chunk[0] = 3;
      chunk[1] = flags;
      chunk[2] = 0;
      chunk[3] = handle;
      chunk[4] = count;
      chunk.set(data.slice(data.length - remaining, data.length - remaining + copybytes), header_size);
      
      addLog(`TX Chunk -> ${toHex(chunk)}`);
      await writeCharacteristicValue(char, chunk);
      
      remaining -= copybytes;
      header_size = 5;
      count++;
    }
  };

  const handleLegacyAuthNotification = async (event) => {
    try {
      const dataView = event.target.value;
      const data = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
      addLog(`RX Auth Notification <- ${toHex(data)}`);

      // Check header prefix
      if (data[0] !== 0x10) {
        addLog(`Warn: Ignored notification with header ${data[0].toString(16)}`);
        return;
      }

      const responseToCmd = data[1];
      const status = data[2];

      if (responseToCmd === 0x01) {
        // Step 1 Response: Key verification
        if (status === 0x01) {
          addLog("Key accepted by band. Requesting challenge...");
          setAuthStatus("Key accepted. Requesting random challenge...");
          
          addLog("TX Challenge Request -> 02 08");
          const reqChallenge = new Uint8Array([0x02, 0x08]);
          if (authCharRef.current) {
            await writeCharacteristicValue(authCharRef.current, reqChallenge);
          }
        } else {
          // If first attempt (standard key) fails, retry Step 1 with reversed key order
          if (authAttemptRef.current === 1) {
            addLog("WARN: Standard key rejected. Retrying with reversed key order...");
            authAttemptRef.current = 2;
            setAuthStatus("Key rejected. Retrying with reversed key...");

            const hexMatch = authKey.trim().replace(/^0x/i, "").match(/([a-f0-9]{32})/i);
            const cleanKey = hexMatch[1];
            let keyBytes = new Uint8Array(cleanKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
            keyBytes.reverse();

            const sendKeyCmd = new Uint8Array(18);
            sendKeyCmd[0] = 0x01;
            sendKeyCmd[1] = 0x08;
            sendKeyCmd.set(keyBytes, 2);

            addLog(`TX Send Key (reversed) -> ${toHex(sendKeyCmd)}`);
            if (authCharRef.current) {
              await writeCharacteristicValue(authCharRef.current, sendKeyCmd);
            }
          } else {
            addLog("ERROR: Both standard and reversed keys rejected by band.");
            throw new Error("Authentication key rejected. Check key correctness.");
          }
        }
      } else if (responseToCmd === 0x02) {
        // Step 2 Response: Challenge random number
        if (status === 0x01) {
          setAuthStatus(authAttemptRef.current === 1 
            ? "Challenge received. Computing encryption signature..." 
            : "New challenge received. Trying reversed key order...");
          
          // Extrapolate the 16-byte random challenge (index 3 to 18)
          const challenge = data.slice(3, 19);
          addLog(`Challenge (len: ${challenge.length}): ${toHex(challenge)}`);
          
          // Encrypt challenge with key (passing whether to reverse the key byte order)
          const encrypted = await encryptChallenge(authKey, challenge, authAttemptRef.current === 2);
          addLog(`AES Ciphertext Output: ${toHex(encrypted)}`);
          
          setAuthStatus("Sending encrypted response handshake...");
          // Send response command: [0x03, 0x08, ...16 encrypted bytes]
          const response = new Uint8Array(18);
          response[0] = 0x03;
          response[1] = 0x08;
          response.set(encrypted, 2);

          if (authCharRef.current) {
            addLog(`TX Signature Response -> ${toHex(response)}`);
            await writeCharacteristicValue(authCharRef.current, response);
          }
        } else {
          addLog("ERROR: Band rejected challenge request command.");
          throw new Error("Band rejected challenge request.");
        }
      } else if (responseToCmd === 0x03) {
        // Step 3 Response: Signature verification
        if (status === 0x01) {
          addLog("Auth verified by band! Authentication successful.");
          setAuthStatus("Pairing verified! Accessing biometrics...");
          
          // Authentication succeeded! Now hook up heart rate measurements
          await subscribeToHeartRate(deviceRef.current.gatt);
        } else {
          addLog("ERROR: Band rejected auth signature (Legacy protocol).");
          throw new Error("Band rejected auth signature (Legacy mode). Mi Band 6 requires ECDH Auth — select 'ECDH Auth (Mi Band 6)' in Settings, then refresh page & retry.");
        }
      }
    } catch (err) {
      console.error("Auth process error:", err);
      addLog(`ERROR: ${err.message || err}`);
      setErrorMsg(err.message || "Auth handshake failed.");
      disconnectDevice();
    }
  };

  const handleEcdhAuthNotification = async (event) => {
    try {
      const dataView = event.target.value;
      const value = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
      addLog(`RX Chunk Notification <- ${toHex(value)}`);

      if (value.length <= 1 || value[0] !== 3) {
        addLog(`Warn: Ignored non-chunk notification header ${value[0]}`);
        return;
      }

      const CHUNKED2021_ENDPOINT_AUTH = 130;
      const sequenceNumber = value[4];
      let headerSize = 5;

      if (sequenceNumber === 0) {
        // First packet checks
        if (value[9] === CHUNKED2021_ENDPOINT_AUTH && value[10] === 0 && value[11] === 16 && value[12] === 4 && value[13] === 1) {
          addLog("Reassembling key exchange payload...");
          setAuthStatus("Receiving remote challenge...");
          reassembleBufferPointerRef.current = 0;
          headerSize = 14;
          reassembleBufferExpectedBytesRef.current = value[5] - 3;
        } else if (value[9] === CHUNKED2021_ENDPOINT_AUTH && value[10] === 0 && value[11] === 16 && value[12] === 5 && value[13] === 1) {
          addLog("✅ Auth verified by band! Authentication successful.");
          setAuthStatus("Pairing verified! Accessing biometrics...");
          
          if (chunkedReadCharRef.current) {
            chunkedReadCharRef.current.removeEventListener("characteristicvaluechanged", handleEcdhAuthNotification);
          }
          await subscribeToHeartRate(deviceRef.current.gatt);
          return;
        } else if (value[9] === CHUNKED2021_ENDPOINT_AUTH && value[12] === 5) {
          // Auth result with failure status (success was already handled above)
          addLog(`❌ ECDH auth REJECTED by band. Status byte: ${value[13]}, Raw: ${toHex(value.slice(9, 14))}`);
          throw new Error(`Band rejected ECDH auth signature (status: ${value[13]}). Check secret key correctness.`);
        } else {
          addLog(`Warn: Unhandled sequence 0 headers: ${toHex(value.slice(9, 14))}`);
          return;
        }
      } else {
        // Subsequent packets
        if (sequenceNumber !== lastSequenceNumberRef.current + 1) {
          addLog(`ERROR: Out of order chunk sequence. Expected ${lastSequenceNumberRef.current + 1}, got ${sequenceNumber}`);
          throw new Error("Out of order chunk sequence.");
        }
      }

      const bytesToCopy = value.length - headerSize;
      if (bytesToCopy > 0) {
        reassembleBufferRef.current.set(value.subarray(headerSize), reassembleBufferPointerRef.current);
        reassembleBufferPointerRef.current += bytesToCopy;
      }
      lastSequenceNumberRef.current = sequenceNumber;

      if (reassembleBufferPointerRef.current === reassembleBufferExpectedBytesRef.current && reassembleBufferExpectedBytesRef.current > 0) {
        addLog("ECDH key exchange payload fully reassembled.");
        setAuthStatus("Solving Diffie-Hellman session key...");

        const payload = reassembleBufferRef.current;
        const remoteRandom = new Uint8Array(payload.subarray(0, 16));
        const remotePublicEC = new Uint8Array(payload.subarray(16, 64));

        addLog(`Remote Challenge: ${toHex(remoteRandom)}`);
        addLog(`Remote Public Key: ${toHex(remotePublicEC)}`);

        // Convert remote public key to BigInt point
        const rx = bytesToBigIntLE(remotePublicEC.slice(0, 24));
        const ry = bytesToBigIntLE(remotePublicEC.slice(24, 48));
        const remotePoint = [rx, ry];

        if (!isPointOnCurve(remotePoint)) {
          throw new Error("Remote public key point is not on the curve.");
        }

        // Compute shared secret point = prv * remotePublicEC
        const prvInt = bytesToBigInt(prvBytesRef.current);
        const sharedPoint = pointMultiply(prvInt, remotePoint);
        if (!sharedPoint) {
          throw new Error("Computed shared point is at infinity.");
        }

        const sharedSecretX = bigIntToBytesLE(sharedPoint[0], 24);
        addLog(`ECDH Shared Secret X: ${toHex(sharedSecretX)}`);

        // Compute finalSharedSessionAES key = sharedSecretX[8..23] ^ authKey
        const hexMatch = authKey.trim().replace(/^0x/i, "").match(/([a-f0-9]{32})/i);
        const cleanKey = hexMatch[1];
        const secretKey = new Uint8Array(cleanKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        
        const finalSharedSessionAES = new Uint8Array(16);
        for (let i = 0; i < 16; i++) {
          finalSharedSessionAES[i] = sharedSecretX[i + 8] ^ secretKey[i];
        }
        sharedSessionKeyRef.current = finalSharedSessionAES;
        addLog(`Session Key Derived: ${toHex(finalSharedSessionAES)}`);

        setAuthStatus("Generating validation signatures...");

        // Encrypt the 16-byte remoteRandom twice
        addLog("Computing out1 signature (AES-CBC zero-IV with authKey)...");
        const out1 = await encryptChallenge(authKey, remoteRandom, false);
        
        addLog("Computing out2 signature (AES-CBC zero-IV with sessionKey)...");
        const sessionKeyHex = Array.from(finalSharedSessionAES).map(x => x.toString(16).padStart(2, "0")).join("");
        const out2 = await encryptChallenge(sessionKeyHex, remoteRandom, false);

        addLog(`out1 signature: ${toHex(out1)}`);
        addLog(`out2 signature: ${toHex(out2)}`);

        // Send second auth packet: [5, ...out1..., ...out2...]
        const command = new Uint8Array(33);
        command[0] = 5;
        command.set(out1, 1);
        command.set(out2, 17);

        const handle = chunkedHandleRef.current;
        chunkedHandleRef.current++;

        setAuthStatus("Sending validation handshake...");
        addLog("Sending second auth packet (signatures)...");
        await writeChunkedValue(chunkedWriteCharRef.current, CHUNKED2021_ENDPOINT_AUTH, handle, command);
      }
    } catch (err) {
      console.error("ECDH Auth process error:", err);
      addLog(`ERROR: ${err.message || err}`);
      setErrorMsg(err.message || "ECDH handshake failed.");
      disconnectDevice();
    }
  };

  const subscribeToHeartRate = async (gatt) => {
    addLog("Requesting standard Heart Rate Service...");
    const hrService = await gatt.getPrimaryService(HEART_RATE_SERVICE_UUID);
    addLog("Heart Rate Service acquired.");
    
    const hrChar = await hrService.getCharacteristic(HEART_RATE_CHAR_UUID);
    addLog("Subscribing to standard BPM notification descriptor...");
    await hrChar.startNotifications();
    hrChar.addEventListener("characteristicvaluechanged", handleHeartRateNotification);
    addLog("Heart rate streaming unlocked.");

    setIsConnected(true);
    setIsConnecting(false);
    setAuthStatus("");
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
    addLog("Device disconnected.");
    setIsConnected(false);
    setLiveBPM(0);
    setDevice(null);
    deviceRef.current = null;
    setAuthStatus("");
  };

  const disconnectDevice = () => {
    addLog("Disconnecting device...");
    const dev = deviceRef.current;
    if (dev && dev.gatt.connected) {
      dev.gatt.disconnect();
    }
    setIsConnected(false);
    setLiveBPM(0);
    setDevice(null);
    deviceRef.current = null;
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

      {/* Advanced Settings & Diagnostics console */}
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
            <>
              <div className="cyber-input-group">
                <span className="tech-caps cyber-label">32-character Auth Key (Gadgetbridge)</span>
                <input 
                  type="text" 
                  className="cyber-input"
                  style={{ fontSize: "12px", letterSpacing: "1px", padding: "10px" }}
                  placeholder="Paste key or 'MAC;KEY' raw string"
                  value={authKey}
                  onChange={(e) => saveAuthSettings("authKey", e.target.value)}
                />
                <span style={{ fontSize: "9px", color: "var(--text-muted)", lineHeight: "1.3", marginTop: "2px" }}>
                  💡 Key is required because modern Mi Bands block heart rate requests unless authenticated with a cryptographic handshake. Key is saved locally in browser storage.
                </span>
              </div>

              <div className="cyber-input-group" style={{ marginTop: "4px" }}>
                <span className="tech-caps cyber-label">Auth Protocol</span>
                <div style={{ display: "flex", gap: "14px", marginTop: "4px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "11px", color: "var(--text-primary)" }}>
                    <input 
                      type="radio" 
                      name="authProtocol" 
                      value="ecdh" 
                      checked={authProtocol === "ecdh"}
                      onChange={(e) => saveAuthSettings("authProtocol", e.target.value)}
                      style={{ accentColor: "var(--neon-cyan)" }}
                    />
                    ECDH Auth (Mi Band 6)
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "11px", color: "var(--text-primary)" }}>
                    <input 
                      type="radio" 
                      name="authProtocol" 
                      value="legacy" 
                      checked={authProtocol === "legacy"}
                      onChange={(e) => saveAuthSettings("authProtocol", e.target.value)}
                      style={{ accentColor: "var(--neon-cyan)" }}
                    />
                    Legacy Auth (Mi Band 4/5)
                  </label>
                </div>
              </div>
            </>
          )}

          {/* Scrolling Diagnostics Console */}
          <div style={{ marginTop: "8px", borderTop: "1px solid rgba(0, 243, 255, 0.1)", paddingTop: "10px" }}>
            <span className="tech-caps" style={{ fontSize: "9px", color: "var(--neon-cyan)", display: "block", marginBottom: "6px", fontWeight: "800" }}>
              📊 TELEMETRY PROTOCOL DIAGNOSTICS
            </span>
            <div 
              style={{ 
                fontFamily: "'Courier New', Courier, monospace", 
                fontSize: "10px", 
                color: "rgba(0, 243, 255, 0.85)", 
                backgroundColor: "#03060c", 
                padding: "8px", 
                borderRadius: "6px", 
                maxHeight: "150px", 
                overflowY: "auto",
                lineHeight: "1.4",
                border: "1px solid rgba(0, 243, 255, 0.05)",
                whiteSpace: "pre-wrap",
                textAlign: "left"
              }}
            >
              {debugLogs.length === 0 ? (
                <span style={{ color: "var(--text-muted)" }}>[Idle] Waiting for pairing connection...</span>
              ) : (
                debugLogs.map((log, idx) => (
                  <div key={idx} style={{ borderBottom: "1px solid rgba(0, 243, 255, 0.02)", padding: "2px 0" }}>{log}</div>
                ))
              )}
            </div>
          </div>
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
