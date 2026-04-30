import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt =
  "Woven — The best way to make and edit short form video with AI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const logoData = await readFile(
    join(process.cwd(), "public", "woven-logo.png"),
    "base64",
  );
  const logoSrc = `data:image/png;base64,${logoData}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px",
          background: "#fcfcfa",
          fontFamily: "system-ui, -apple-system, sans-serif",
          color: "#000000",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} width={72} height={72} alt="Woven" />
          <div
            style={{
              fontSize: 40,
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            Woven
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 88,
              fontWeight: 600,
              letterSpacing: "-0.04em",
              lineHeight: 1.02,
              maxWidth: 980,
            }}
          >
            The best way to make and edit short form video with AI.
          </div>
          <div
            style={{
              fontSize: 32,
              color: "#555555",
              letterSpacing: "-0.01em",
              lineHeight: 1.3,
              maxWidth: 900,
            }}
          >
            A native Mac studio for short-form vertical video. Bring your
            keys, or use Woven-hosted models.
          </div>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 22,
            color: "#666666",
          }}
        >
          woven.video
        </div>
      </div>
    ),
    { ...size },
  );
}
