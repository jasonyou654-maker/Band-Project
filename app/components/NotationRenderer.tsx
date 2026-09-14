"use client";

import { useEffect, useRef, useState } from "react";
import { hasEncodedSourceLayout, hasGrandStaff } from "../lib/musicxml";

type NotationRendererProps = {
  musicXml: string;
  title: string;
  preserveSourceLayout?: boolean;
  thumbnail?: boolean;
};

export function NotationRenderer({ musicXml, title, preserveSourceLayout = false, thumbnail = false }: NotationRendererProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const sourceLayout = preserveSourceLayout || hasEncodedSourceLayout(musicXml);
  const grandStaff = hasGrandStaff(musicXml);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      if (!hostRef.current) return;
      try {
        const { OpenSheetMusicDisplay } = await import("opensheetmusicdisplay");
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = "";
        setError("");
        const score = new OpenSheetMusicDisplay(hostRef.current, {
          autoResize: true, backend: "svg", drawTitle: false, drawComposer: false,
          // Compact engraving is for card thumbnails only. Full scores must
          // retain stems, beams, rests, accidentals and multi-staff spacing.
          drawingParameters: thumbnail ? "compacttight" : "default",
          pageFormat: sourceLayout && !thumbnail ? "A4_P" : "Endless",
          newSystemFromXML: sourceLayout && !thumbnail,
          newPageFromXML: sourceLayout && !thumbnail,
          newSystemFromNewPageInXML: sourceLayout && !thumbnail,
          setWantedStemDirectionByXml: true,
        });
        await score.load(musicXml);
        if (!cancelled) score.render();
      } catch {
        if (!cancelled) setError("这份 MusicXML 无法渲染为五线谱。");
      }
    }
    void render();
    return () => { cancelled = true; };
  }, [musicXml, sourceLayout, thumbnail]);

  return <div ref={hostRef} className={`osmd-host ${sourceLayout && !thumbnail ? "source-layout" : ""} ${grandStaff && !thumbnail ? "grand-staff" : ""} ${thumbnail ? "thumbnail-score" : ""}`} aria-label={`${title} 的五线谱`}>{error && <p className="notation-error">{error}</p>}</div>;
}
