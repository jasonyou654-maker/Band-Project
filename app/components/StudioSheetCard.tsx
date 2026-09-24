import Link from "next/link";
import type { StudioSheet } from "@/app/lib/studio17-models";
import { StudioAvatar } from "./StudioAvatar";

export function StudioSheetCard({ sheet, compact = false }: { sheet: StudioSheet; compact?: boolean }) {
  return <article className={`s17-sheet-card ${compact ? "compact" : ""}`}>
    <Link className="s17-sheet-cover" href={`/sheets/${sheet.id}`} style={{ "--sheet-accent": sheet.accent } as React.CSSProperties}>
      <span className="s17-sheet-paper"><i/><i/><i/><i/><i/></span>
      <span className="s17-sheet-instrument">{sheet.instrument}</span>
    </Link>
    <div className="s17-sheet-copy">
      <Link href={`/sheets/${sheet.id}`}><h3>{sheet.title}</h3></Link>
      <p>{sheet.artist}</p>
      <div className="s17-sheet-meta"><span>{sheet.arrangement}</span><span>{sheet.difficulty}</span></div>
      <div className="s17-sheet-uploader"><StudioAvatar name={sheet.uploader} src={sheet.avatarUrl} size="small"/><span>{sheet.uploader}</span></div>
    </div>
  </article>;
}

