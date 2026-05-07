import { useId } from "react";

const PatternBackground = ({
  label = "Pending",
  from = "#0a1f2e",
  to = "#020617",
  stripeColor = "rgba(255,255,255,0.06)",
}) => {
  const id = useId(); // avoids ID collisions
  const gradientId = `bgGradient-${id}`;
  const patternId = `stripePattern-${id}`;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
      }}
    >
      <svg
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>

          <pattern
            id={patternId}
            width="14"
            height="14"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect x="0" y="0" width="7" height="14" fill={stripeColor} />
          </pattern>
        </defs>

        <rect width="100%" height="100%" fill={`url(#${gradientId})`} />
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>

      {/* HTML label overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          color: "#38bdf8",
          fontSize: "0.9rem",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </div>
    </div>
  );
};

export default PatternBackground;
