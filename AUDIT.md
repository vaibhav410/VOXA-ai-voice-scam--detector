# Website audit — 14 October 2026

## Preservation correction

At the user's request, the previous Detect Platform dashboard and its sections, API Playground, Voice Platform, voice catalog, favorites, projects and API Keys information page have been restored from the earlier ZIP. The new call-safety dashboard remains available at `#/call-safety`; the original dashboard uses `#/dashboard`. Existing browser collection keys are reused without clearing data. Speech-to-Text and recording controls reuse the current consent, transcription and analysis implementation. Unconnected services are labeled accurately. Create Voice and Aurigin remain removed as previously requested. The historical cleanup notes below describe the earlier audit, not the final navigation inventory.

Restoration verification: 28 routes across 320, 820 and 1440 pixel widths (84 checks), with no page errors or horizontal overflow. Seeded existing projects, voices and favorites survived navigation and project edits; catalog search, category filters, analysis and report navigation passed. The current upload-to-dashboard, transcript download, consent, live alerts and evaluation browser checks also passed. Future cleanup should preserve these dashboards and sections unless their removal is explicitly requested.

Reviewed the public landing page, workspace entry, dashboard, recorded analysis, live monitor, reports, evaluation, settings, workspace details and legacy URLs.

## Corrected

- Replaced the old marketing page with an original, responsive VOXA landing page. Removed claims about free API operation, on-device transcription, speaker verification, prosody analysis, provider fallback and automatic call interception that the application does not implement.
- Removed the inactive GitHub button and fake password login. Entry now uses an optional display name and clearly identifies a local demo workspace. Links can take users directly to Analysis or Evaluation after entry.
- Corrected misleading account links. Removed the unused public API-key screen; old bookmarks redirect to Settings. Unknown URLs show a usable recovery page. Create Voice remains removed.
- Unified typography, colors, controls, spacing, cards and responsive navigation. The desktop sidebar can be reopened after collapsing. Mobile navigation, focus styles, skip links and form labels are functional.
- Self-hosted Inter and Geist Mono to eliminate external font requests that intermittently blocked page loads. Font licenses accompany the assets under `assets/fonts/`.
- Added cancellation for analysis/transcription and propagated cancellation to provider requests. Leaving a page stops waiting requests and cannot unexpectedly create a report or navigate the user back.
- Locked analysis inputs while requests run. Corrected stale media/transcript handling, microphone permission races, recording duration and stream cleanup. Independent provider operations now run concurrently.
- Rebuilt the live-session lifecycle so sessions can stop, finalize, retry and restart. Interim warnings can be revised by finalized speech. Saved live alerts are linked to their report and removed with it. Live duration excludes time spent reviewing the stopped session.
- Corrected an `undefined` media-type label. Reports now show filenames and keyboard-accessible report links, and search includes filenames and transcripts.
- Moved optional report labels out of the main workflow. Put transcription selection beside the transcript controls and showed only relevant provider configuration indicators.
- Replaced static “not connected” settings with configuration status from the server. Blank Gemini responses remain unavailable rather than being marked successful. Corrected missing-file HTTP responses and accepted common audio MIME aliases.
- Preserved consent gating, ephemeral uploads, session-first reports, opt-in 24-hour retention, expiry purging, exports and deletion.

## Verification

- **13 automated tests passed:** provider boundaries, malformed responses, cancellation, upload validation, local font serving, secret-file protection, live proxy behavior, Hindi/mixed-language fraud rules and benign safety statements.
- **8 page routes checked at desktop and mobile sizes**, plus the analysis report flow: no observed JavaScript errors, failed local asset requests or broken landing anchors.
- **51 responsive checks passed** across widths from 320 to 1920 pixels. No page-level horizontal overflow was observed. Static browsing made no external network requests.
- Basic rendered-text color-contrast checks found no remaining failures on the landing page, entry, dashboard, analysis, live monitor, settings, populated report and evaluation page. These checks are not a complete accessibility certification.
- Browser workflows passed for microphone recording, upload, both transcription choices, cancellation, navigation during a request, transcript persistence/download, expiry, delete-all and sidebar recovery.
- Two consecutive live sessions passed browser checks, including provisional-warning revision, microphone shutdown and linked-alert deletion.
- The real provider flow on a labeled neural synthetic demo returned a usable transcript and an `AI_GENERATED` detection result. Model performance limits, including the missed desktop-TTS sample, remain documented in [evaluation/README.md](evaluation/README.md).

## Scope

VOXA remains a local demo workspace with server-side provider credentials. This audit does not add hosted authentication or establish population-level fraud/deepfake accuracy. Transcription and media detection use configured cloud providers; intent rules run locally. Real human-call false-alarm rates, broad accent coverage and noisy-channel performance still need a consented representative dataset.

Run with `npm install` and `npm start`, then open `http://127.0.0.1:5174/`.
