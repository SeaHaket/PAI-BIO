import { useEffect, useRef, useState } from "react";

export default function FitnessDial({ fitnessAge, chronoAge, score }) {
  const canvasRef = useRef(null);
  const [displayedAge, setDisplayedAge] = useState(chronoAge);

  // Smooth counter animation for the age number
  useEffect(() => {
    let frame;
    let start = null;
    const from = displayedAge;
    const to = fitnessAge;
    const duration = 1000; // 1 second sweep

    const animate = (ts) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3); // cubic ease out
      setDisplayedAge(Math.round(from + (to - from) * ease));
      if (progress < 1) {
        frame = requestAnimationFrame(animate);
      }
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [fitnessAge]);

  // High-DPI Canvas Rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;

    // Display size in CSS pixels
    const width = 320;
    const height = 220;

    // Set backing store size scaled by DPR
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    // Set display size in CSS
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    // Scale drawing context to match backing store
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height * 0.7;
    const radius = 105;
    const startAngle = Math.PI * 0.9;
    const endAngle = Math.PI * 2.1;
    const angleRange = endAngle - startAngle;

    // Choose color scheme based on score
    let neonColor = "#00f3ff"; // Cyber Cyan
    let glowColor = "rgba(0, 243, 255, 0.4)";
    if (score >= 75) {
      neonColor = "#dfff00"; // Volt Green
      glowColor = "rgba(223, 255, 0, 0.4)";
    } else if (score < 45) {
      neonColor = "#ff2a5f"; // Crimson Alert
      glowColor = "rgba(255, 42, 95, 0.4)";
    } else if (score < 75) {
      neonColor = "#ff9d00"; // Warning Orange
      glowColor = "rgba(255, 157, 0, 0.4)";
    }

    // 1. Draw outer dashboard housing arc (Track)
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.lineWidth = 14;
    ctx.strokeStyle = "rgba(18, 28, 48, 0.8)";
    ctx.lineCap = "round";
    ctx.stroke();

    // 2. Draw active metric progress arc
    const scorePct = Math.max(0, Math.min(100, score)) / 100;
    const currentEndAngle = startAngle + (angleRange * scorePct);

    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, currentEndAngle);
    ctx.lineWidth = 14;
    ctx.strokeStyle = neonColor;
    ctx.lineCap = "round";
    ctx.stroke();

    // 3. Draw Neon Glow Overlay (Layered shadows for deep glow)
    ctx.save();
    ctx.shadowBlur = 15;
    ctx.shadowColor = neonColor;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, currentEndAngle);
    ctx.lineWidth = 4;
    ctx.strokeStyle = neonColor;
    ctx.stroke();
    ctx.restore();

    // 4. Draw Tachometer Tech Tick Marks
    const totalTicks = 35;
    ctx.save();
    for (let i = 0; i <= totalTicks; i++) {
      const angle = startAngle + (angleRange * (i / totalTicks));
      const isMajor = i % 5 === 0;
      const tickLength = isMajor ? 10 : 6;
      
      const startR = radius - 20;
      const endR = radius - 20 - tickLength;

      const sx = cx + Math.cos(angle) * startR;
      const sy = cy + Math.sin(angle) * startR;
      const ex = cx + Math.cos(angle) * endR;
      const ey = cy + Math.sin(angle) * endR;

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      
      // Highlight tick marks that the progress bar has swept past
      const tickPct = i / totalTicks;
      if (tickPct <= scorePct) {
        ctx.strokeStyle = neonColor;
        ctx.lineWidth = isMajor ? 2.5 : 1.5;
        if (isMajor) {
          ctx.shadowBlur = 4;
          ctx.shadowColor = neonColor;
        }
      } else {
        ctx.strokeStyle = "rgba(100, 116, 139, 0.25)";
        ctx.lineWidth = 1;
        ctx.shadowBlur = 0;
      }
      ctx.stroke();
    }
    ctx.restore();

    // 5. Speedometer Pointer / Telemetry Sweep Needle
    const pointerAngle = startAngle + (angleRange * scorePct);
    const needleInnerR = radius - 8;
    const needleOuterR = radius + 8;
    const nx1 = cx + Math.cos(pointerAngle) * needleInnerR;
    const ny1 = cy + Math.sin(pointerAngle) * needleInnerR;
    const nx2 = cx + Math.cos(pointerAngle) * needleOuterR;
    const ny2 = cy + Math.sin(pointerAngle) * needleOuterR;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(nx1, ny1);
    ctx.lineTo(nx2, ny2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#ffffff";
    ctx.shadowBlur = 8;
    ctx.shadowColor = "#ffffff";
    ctx.stroke();
    ctx.restore();

  }, [score]);

  // Delta calculation details
  const diff = fitnessAge - chronoAge;
  let diffLabel = "";
  let diffColor = "var(--text-muted)";
  let badgeColor = "rgba(100, 116, 139, 0.1)";

  if (diff < 0) {
    diffLabel = `${Math.abs(diff)} YRS YOUNGER`;
    diffColor = "var(--neon-volt)";
    badgeColor = "rgba(223, 255, 0, 0.15)";
  } else if (diff > 0) {
    diffLabel = `${diff} YRS OLDER`;
    diffColor = "var(--neon-alert)";
    badgeColor = "rgba(255, 42, 95, 0.15)";
  } else {
    diffLabel = "SAME AS CHRONO";
    diffColor = "var(--neon-cyan)";
    badgeColor = "rgba(0, 243, 255, 0.15)";
  }

  return (
    <div style={{ position: "relative", textAlign: "center", width: "100%", margin: "0 auto" }}>
      {/* Outer Dial Canvas */}
      <canvas ref={canvasRef} style={{ display: "block", margin: "0 auto" }} />
      
      {/* HUD Centered Telemetry Labels */}
      <div style={{
        position: "absolute",
        top: "40%",
        left: 0,
        right: 0,
        transform: "translateY(-10%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center"
      }}>
        {/* Large digital age display */}
        <span 
          className="tech-font" 
          style={{
            fontSize: "64px",
            fontWeight: "900",
            color: "#ffffff",
            letterSpacing: "-2px",
            lineHeight: 1,
            textShadow: "0 0 20px rgba(255, 255, 255, 0.2)"
          }}
        >
          {displayedAge}
        </span>
        
        {/* Metric Label */}
        <span 
          className="tech-caps" 
          style={{
            fontSize: "11px",
            color: "var(--text-muted)",
            marginTop: "2px"
          }}
        >
          FITNESS AGE
        </span>

        {/* Dynamic Delta Badge */}
        <div 
          className="tech-caps"
          style={{
            fontSize: "11px",
            fontWeight: "800",
            color: diffColor,
            backgroundColor: badgeColor,
            border: `1px solid ${diffColor}40`,
            borderRadius: "4px",
            padding: "4px 10px",
            marginTop: "12px",
            boxShadow: `0 0 10px ${diffColor}20`
          }}
        >
          {diffLabel}
        </div>
      </div>
    </div>
  );
}
