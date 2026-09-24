# Studio17 V0.1 — Architecture, Roadmap and Workload

## Product goal

V0.1 turns the existing BandProject demo into Studio17: a small but complete product where a musician can sign in, establish a profile, publish a properly described score, manage it, save other scores, reopen recent work, and keep private AI transcription drafts in one library.

The existing upload, browsing, score rendering, OMR integration and private transcription pipeline remain in place. AI model improvement is intentionally deferred.

## Reusable V0 foundations

- The Next/Vinext application shell, score browser and visual system.
- MusicXML validation and rendering, PDF/image/MusicXML upload handling, and R2-backed source files.
- D1 access through Drizzle and the existing migration chain.
- Owner-scoped transcription jobs, private R2 results and revision history.
- The hosted identity headers and built-in sign-in/sign-out endpoints.
- Existing processor APIs and fallback behavior; no transcription model rewrite is required for V0.1.

## V0.1 architecture

The browser never supplies a trusted owner identity. Every private write resolves the signed-in user on the server. D1 stores users, metadata and relationships; R2 stores score files and private transcription artifacts.

### Data changes

- `users`: email identity, unique username, display name, avatar URL, bio and timestamps.
- `sheets`: retain every V0 field and add owner, arrangement, tags, description, rights declaration, visibility, download count, update time and soft-delete time.
- `favorites`: one saved relationship per user and score.
- `recent_items`: one last-opened record per user and score/transcription.
- `content_reports`: reporter, score, reason, details, state and creation time.

Legacy score rows remain readable because new sheet columns have defaults and nullable ownership.

### Pages

- `/`: retained Studio17 Explore experience.
- `/account`: first-login registration and profile editing.
- `/users/[username]`: basic public creator profile.
- `/library`: uploads, private AI drafts, saved scores and recent items.
- `/upload`: structured score publishing.
- `/sheets/[id]`: permanent score detail, preview, save, download and report actions.
- `/sheets/[id]/edit`: owner-only metadata, visibility and deletion controls.
- `/transcription` and `/transcription/[id]`: retained private AI workflow.

### APIs

- `GET/PATCH /api/me`
- `GET /api/library`
- `GET/POST /api/sheets`
- `GET/PATCH/DELETE /api/sheets/[id]`
- `POST/DELETE /api/sheets/[id]/favorite`
- `POST /api/sheets/[id]/view` and `/download`
- `GET /api/sheets/[id]/source`
- `POST /api/reports`

Existing transcription APIs continue to own creation, polling, revisions and deletion. Opening a transcription now also updates recent activity.

## Delivery stages and dependencies

1. **Identity and schema (2–3 days):** trusted sign-in, automatic first-login profile creation, migration and compatibility defaults.
2. **Score publishing and management (3–4 days):** structured upload, permanent detail pages, owner editing/deletion, R2 source delivery and reporting.
3. **My Library (2–3 days):** uploads, transcription history, durable saves and recent activity.
4. **Hardening and release (2–3 days):** permissions, empty/error states, responsive UI, migration/build/regression checks and private deployment.

Total expected focused effort: **9–13 engineering days**, or roughly **2–3 calendar weeks** for one developer including review and deployment. The earlier 11–16 day range remains reasonable if production data repair, accessibility review or processor integration issues appear.

## Deferred after V0.1

Band accounts, member discovery, community feeds, online rehearsal, real-time collaboration, advanced moderation and transcription-model training remain outside this release. Those depend on a stable user/content ownership model and real usage data from this closed loop.
