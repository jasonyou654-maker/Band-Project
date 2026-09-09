"use client";

import { useEffect, useRef, useState } from "react";
import { hasEncodedSourceLayout } from "../lib/musicxml";

export function NotationRenderer({ musicXml, title, preserveSourceLayout = false }: { musicXml: string; title: string; preserveSourceLayout?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const sourceLayout = preserveSourceLayout || hasEncodedSourceLayout(musicXml);

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
          drawingParameters: sourceLayout ? "default" : "compacttight",
          pageFormat: sourceLayout ? "A4_P" : "Endless",
          newSystemFromXML: sourceLayout,
          newPageFromXML: sourceLayout,
          newSystemFromNewPageInXML: sourceLayout,
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
  }, [musicXml, preserveSourceLayout]);

  return <div ref={hostRef} className={`osmd-host ${sourceLayout ? "source-layout" : ""}`} aria-label={`${title} 的五线谱`}>{error && <p className="notation-error">{error}</p>}</div>;
}
