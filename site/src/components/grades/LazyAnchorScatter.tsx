"use client";
import { useEffect, useRef, useState } from "react";
import { AnchorScatter } from "./AnchorScatter";
import { fetchJson } from "@/lib/fetchJson";
import { dataUrl } from "@/lib/dataFiles";
import type { DcGrades, Leg } from "@/lib/types";

/** The anchor scatter without its ~47KB of anchor rows in the page HTML.
 *
 *  /escalation is a static page whose server props are serialized verbatim,
 *  and it deliberately never carried dc_grades.json's `anchors` (see
 *  escalationGradeSlice). This fetches the published file the first time the
 *  scatter's slot scrolls into view — which, inside the closed "full grading
 *  record" disclosure, is only after a reader opens it. */
export function LazyAnchorScatter({ legs }: { legs: Record<string, Leg> | undefined }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [anchors, setAnchors] = useState<DcGrades["anchors"] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let started = false;
    const load = () => {
      if (started) return;
      started = true;
      fetchJson<DcGrades>(dataUrl("dc_grades.json"))
        .then((d) => setAnchors(d.anchors))
        .catch(() => setFailed(true));
    };
    if (typeof IntersectionObserver === "undefined") { load(); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { load(); io.disconnect(); }
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ minHeight: anchors ? undefined : 120 }}>
      {anchors ? (
        <AnchorScatter anchors={anchors} legs={legs} />
      ) : (
        <p className="method" style={{ padding: "24px 0" }}>
          {failed
            ? "The anchor scatter couldn't load. The rows are in /data/dc_grades.json."
            : "Loading every vintage anchor…"}
        </p>
      )}
    </div>
  );
}
