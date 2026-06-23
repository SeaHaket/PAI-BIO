export default function MetricCard({ icon, label, value, sub, statusColor }) {
  // Generate background color and glow shadow dynamically based on status color
  const statusGlow = statusColor ? `${statusColor}22` : "rgba(0, 243, 255, 0.05)";
  const statusBorder = statusColor ? `${statusColor}44` : "rgba(0, 243, 255, 0.1)";

  return (
    <div 
      className="cyber-panel" 
      style={{
        flex: "1 1 calc(50% - 8px)", // Wrap nicely on smaller screens
        minWidth: "135px",
        padding: "16px 14px",
        border: `1px solid ${statusBorder}`,
        backgroundColor: "rgba(13, 20, 35, 0.55)",
        boxShadow: `0 8px 24px 0 rgba(0, 0, 0, 0.25), 0 0 12px ${statusGlow}`
      }}
    >
      {/* Icon with glowing backdrop */}
      <div 
        style={{
          width: "32px",
          height: "32px",
          borderRadius: "8px",
          backgroundColor: statusColor ? `${statusColor}15` : "rgba(0, 243, 255, 0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "16px",
          border: `1px solid ${statusColor ? `${statusColor}33` : "rgba(0, 243, 255, 0.15)"}`,
          boxShadow: `0 0 10px ${statusColor ? `${statusColor}15` : "transparent"}`
        }}
      >
        {icon}
      </div>

      {/* Main Metric Value */}
      <div 
        className="tech-font" 
        style={{
          fontSize: "24px",
          fontWeight: "800",
          color: "#ffffff",
          marginTop: "12px",
          lineHeight: 1,
          letterSpacing: "-0.5px"
        }}
      >
        {value}
      </div>

      {/* Metric Label */}
      <div 
        className="tech-caps" 
        style={{
          fontSize: "10px",
          color: "var(--text-muted)",
          marginTop: "6px",
          letterSpacing: "0.08em"
        }}
      >
        {label}
      </div>

      {/* Target Boundary Label */}
      {sub && (
        <div 
          style={{
            fontSize: "10px",
            color: statusColor || "var(--text-muted)",
            marginTop: "3px",
            fontWeight: statusColor ? "600" : "400",
            opacity: 0.8
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
