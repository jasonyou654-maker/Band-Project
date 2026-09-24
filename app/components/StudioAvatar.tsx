/* Avatar URLs may point at user-provided hosts, so a native image is used. */
/* eslint-disable @next/next/no-img-element */
import { initials } from "@/app/lib/studio17-models";

export function StudioAvatar({ name, src, size = "medium" }: { name: string; src?: string | null; size?: "small" | "medium" | "large" }) {
  return <span className={`s17-avatar s17-avatar-${size}`} aria-label={`${name} avatar`}>
    {src ? <img src={src} alt="" /> : initials(name)}
  </span>;
}
