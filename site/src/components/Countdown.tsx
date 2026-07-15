"use client";

import { useEffect, useState } from "react";

// CPI releases at 8:30 AM America/New_York; the fixed offset flips with DST.
// Try both candidate offsets and keep the one that round-trips to 08:30 NY.
function releaseEpoch(dateStr: string): number | null {
  for (const off of ["-04:00", "-05:00"]) {
    const t = new Date(`${dateStr}T08:30:00${off}`);
    if (Number.isNaN(t.getTime())) return null;
    const ny = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(t);
    if (ny === "08:30") return t.getTime();
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function Countdown({ releaseDate }: { releaseDate: string | null }) {
  // null until mounted so the build-time HTML and first client render match
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!releaseDate) return null;
  const target = releaseEpoch(releaseDate);
  if (target == null) return null;
  if (now === null) return <div className="countdown">&nbsp;</div>;

  const diff = target - now;
  if (diff <= 0) {
    return (
      <div className="countdown countdown-live">
        released · 8:30 AM ET
      </div>
    );
  }
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor(diff / 3_600_000) % 24;
  const m = Math.floor(diff / 60_000) % 60;
  const s = Math.floor(diff / 1_000) % 60;
  return (
    <div className="countdown">
      {d}
      <small>d</small>
      {pad(h)}
      <small>h</small>
      {pad(m)}
      <small>m</small>
      {pad(s)}
      <small>s</small>
      <span className="countdown-ctx">to release · 8:30 AM ET</span>
    </div>
  );
}
