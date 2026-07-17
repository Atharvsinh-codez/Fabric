import { FabricMark } from "@/components/brand/fabric-mark";

export function SocialCard() {
  return (
    <div
      style={{
        alignItems: "stretch",
        background: "#eef3f8",
        color: "#121212",
        display: "flex",
        height: "100%",
        padding: "52px",
        width: "100%",
      }}
    >
      <div
        style={{
          alignItems: "flex-start",
          background: "#ffffff",
          border: "1px solid rgba(18,18,18,0.08)",
          borderRadius: "36px",
          display: "flex",
          flex: 1,
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "62px 68px",
        }}
      >
        <div style={{ alignItems: "center", display: "flex", gap: "20px" }}>
          <FabricMark width="45" height="48" />
          <span style={{ fontSize: "42px", fontWeight: 600, letterSpacing: "-0.03em" }}>
            Fabric
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <p
            style={{
              fontSize: "74px",
              fontWeight: 500,
              letterSpacing: "-0.045em",
              lineHeight: 1.02,
              margin: 0,
              maxWidth: "920px",
            }}
          >
            Think spatially. Decide with context.
          </p>
          <p style={{ color: "#59636d", fontSize: "29px", margin: 0 }}>
            Open-source multiplayer canvas for teams and classrooms.
          </p>
        </div>
        <div style={{ color: "#0284c7", display: "flex", fontSize: "23px", fontWeight: 600 }}>
          fabric.athrix.me
        </div>
      </div>
    </div>
  );
}
