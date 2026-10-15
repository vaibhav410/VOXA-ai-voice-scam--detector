# VOXA

Run with Node.js 22 or newer:

```sh
npm install
npm start
```

Open http://127.0.0.1:5174, open the local workspace, and choose New analysis. Do not use Python's static file server for API integration. The Node server binds only to loopback and serves an explicit public-file allowlist. Demo login is not production authentication.

Keys are loaded server-side from `.env.local`, with the existing `css/.env.local` also supported. Never put keys in client JavaScript or share these env files. Supported variables (existing lowercase names also work):

Copy `.env.example` to `.env.local` and fill it in. Providers, free-tier status and limits are documented in [API_USAGE.md](API_USAGE.md).

```
REALITY_DEFENDER_API_KEY=   # voice + image deepfake detection (primary)
SEALEDROSE_API_KEY=         # video detection (12 credits per video)
AUTH_PROVIDER=auto          # auto | realitydefender | sealedrose
DEEPGRAM_API_KEY=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
LUXAND_API_KEY=
FREE_MODE=1                 # default: block providers you have not confirmed as card-free
FREE_MODE_CONFIRMED=        # e.g. realitydefender,deepgram,gemini
```

**FREE_MODE is on by default.** A provider is called only if it is listed in `FREE_MODE_CONFIRMED`, which is your statement that its account has no payment method or auto top-up. Otherwise the app shows "Blocked by FREE_MODE" and makes no request.

## Media pipeline

Start: `npm start` (or double-click `start-voxa.cmd`), then open http://127.0.0.1:5174. Check it with `GET /api/status` (add `?probe=1` for free live health checks).

| Type | Accepted formats | Max size | Authenticity | Speech and intent |
|---|---|---|---|---|
| Voice | wav, mp3, flac, ogg, m4a, webm (microphone) | 20 MB, at least 3 s | Reality Defender (Sealed Rose if `AUTH_PROVIDER=sealedrose`). WebM is converted to WAV locally first. | Deepgram or Gemini transcript, then local scam-intent rules |
| Image | jpg, png, webp | 10 MB | Reality Defender (Sealed Rose optional) | Gemini text extraction (optional), Luxand liveness (optional, separate) |
| Video | mp4, webm, mov | 32 MB, at least 1 s | Sealed Rose video (12 credits). Reality Defender's free plan has no video. | Audio is extracted locally with FFmpeg; transcript uses that audio. Optional soundtrack authenticity is a separate result. |

How a file is handled: the browser uploads with a progress bar (Idle, Uploading, Processing, Completed, Failed, Unsupported). The server checks the file's bytes against the claimed type, size and decodability (FFmpeg) before any provider is called. Raw media lives in memory and in a private temp folder that is deleted after each request. Rate limits and provider outages are retried once; invalid keys, exhausted credits and timeouts are reported with a specific message. A failed provider shows "Unavailable", never an invented score.

Limitations: video visual detection needs Sealed Rose credits; video deepfake accuracy has not been measured. Authenticity and transcription are independent: a transcript says nothing about whether a voice is genuine. Reality Defender's free plan allows 50 scans a month.

Optional Gemini speech/text extraction accepts up to 14 MB to stay below its 20 MB inline request limit after base64 encoding. Pasted text takes precedence for intent rules. Extraction can be inaccurate; review the incident's quoted evidence. Larger files require a pasted transcript. Gemini does not provide authenticity scores.

Optional Luxand JPG/PNG portrait liveness is displayed separately as a provider response, not treated as general deepfake detection. No face database or voice enrollment is created.

Uploads are sent to the selected providers and processed in local server memory, not written to disk. Providers' retention policies apply. Reports, full transcripts and alerts default to this tab session (sessionStorage). Opt in to up to 24-hour local retention. Expired data is purged when accessed and once per minute while the app runs; a closed app purges on next use. Delete-all removes reports and alert history. Browser session restoration can restore sessionStorage. Configured-key status does not establish that credentials or credit balances are valid. API usage may consume provider credits. Voice generation is not part of VOXA; it only analyzes real recordings and live microphone audio.

Validation: `npm test`. Tests mock upstream responses; they do not measure detector accuracy or verify account quotas.

API references:
- https://sealedrose.com/developers
- https://luxand.cloud/face-recognition-blog/how-to-build-facial-recognition-application-with-python
- https://ai.google.dev/api/generate-content
- https://ai.google.dev/gemini-api/docs/audio

Deepgram: optional Nova-3 speech transcription for voice and video, selected separately from detection. Loads `DEEPGRAM_API_KEY`, `deepgram_api`, or `deepgram_api_key`. Multilingual mode (`language=multi`), smart formatting, and model-improvement opt-out are enabled. Existing detection-provider upload limits still apply. Pasted text takes precedence.

Reference: https://developers.deepgram.com/docs/pre-recorded-audio

Use New analysis to record from the microphone or upload audio. Choose Deepgram or Gemini, then Transcribe recording / file to review and edit the transcript before analysis. The Analyze page transcribes after recording stops. Live Monitor streams microphone audio to Deepgram with interim fraud warnings.

After Analyze completes, the analysis dashboard shows authenticity, action priority, matched patterns, recording metadata, and the full transcript. Download the transcript or report, add notes, or update incident status. Older reports retain only their original excerpts; rerun them for a complete transcript.

VOXA has three areas: **Detect Platform** (call safety dashboard, analysis, meetings, intelligence, signal, watermarking, integrations), **Live Monitor** and **Reports**. `#/dashboard` opens the call safety dashboard.

Run `npm run evaluate:rules` and open the Evaluation page. Audio test setup, results, accuracy definitions and limitations: [evaluation/README.md](evaluation/README.md). Genuine human-call accuracy has not been measured yet.

Website audit and redesign: [AUDIT.md](AUDIT.md). Public pages and the workspace self-host Inter and Geist Mono fonts; no external font request is needed. Font licenses are bundled under `assets/fonts/`. Workspace entry uses an optional display name, not a password or hosted account.

## Noise analysis (separate report)

On the **Voice** tab, a selected recording has two independent actions:

- **Analyze Voice**: the existing authenticity + transcript + scam-intent analysis.
- **Analyze Noise**: audio quality and background noise. It makes its own **Noise analysis report** and never touches the voice report. Tick **Create enhanced copy** to also get a denoised file.

Both reports from one selected file share an `uploadId` and link to each other under "Related reports".

There is also a dedicated **Noise reduction** page (sidebar, under Models, `#/noise`): upload audio, tick or untick the enhanced copy, and it opens the same Noise analysis report. It uses the same endpoint and the same saver as the button above.

**How it works (free, local, no provider):** `POST /api/noise` decodes with FFmpeg and measures with JavaScript DSP (`server/noise-core.mjs`, `server/noise.mjs`). No API key is used and nothing leaves the machine. It has the same protections as `/api/analyze`: local origin plus `X-Voxa-Request`, byte sniffing (not the file name), a 20 MB / 1 s to 5 min limit, one job at a time, FFmpeg timeouts, and a private temp directory that is removed on success and failure. Without FFmpeg it returns `503 FFMPEG_MISSING` and no result.

**What each result means, and what it is not:**

| Result | Method | Honest limit |
| --- | --- | --- |
| Speech detected (Yes / No / Uncertain) | Sustained pitch-periodic (voiced) frames whose pitch moves like speech | **Not Silero VAD** or any trained model. Music or singing can read as speech; whispered or very noisy speech can be missed |
| Noise level and noise floor | Quietest steady frames; SNR basis when available, otherwise absolute level | Noise only under continuous speech cannot be separated. Digitally silent pauses mean the floor is not measurable (a noise gate looks the same) |
| SNR | Speech power minus floor power over floor power | Reported only with detected speech, a stable measured floor, and speech clearly above it; otherwise `Unavailable`. Within about 3 dB of truth on the test set; not calibrated |
| Indicators | Mains hum (50/60 Hz tonal peak), high-frequency hiss-like energy, low-frequency rumble | Descriptive only. Sources such as traffic or a fan are never named; crackle and static are not detected |
| Clipping, peak, RMS, silence | Samples of the first channel | First channel only |
| Quality rating and suitability | Transparent rules shown in the report | No numeric score |

If a value cannot be measured the report says `Unavailable` or `Insufficient evidence`; it never invents one.

**Enhancement:** FFmpeg `afwtdn` (adaptive wavelet denoiser), plus notch filters at the detected hum frequency and a 80 Hz high-pass for rumble. The original is never modified. The enhanced copy is a separate mono 16 kHz WAV, so before/after are comparable, and the report shows the measured change in noise floor, SNR, speech level and hum, and whether speech is still detected. The setting was chosen by measurement (FFmpeg `afftdn` with noise tracking left white noise untouched, and with a fixed floor barely moved pink noise); on the test set `afwtdn` lowered the quiet level about 16 dB at a speech-level cost of 0.5 to 3 dB (about 5 dB at 0 dB SNR input, which the report flags). It reports "No measurable improvement" when that is the case (for example already clean speech). Whether it sounds better is a listening judgement VOXA does not score, and denoising can smear speech: analyse **authenticity on the original**, not the enhanced copy.

**Why not librosa or Silero VAD:** librosa needs Python and Silero VAD needs an ONNX runtime (`onnxruntime-node` alone is about 300 MB); both would add a second runtime to a Node app. The FFmpeg + JS approach needs only what the app already ships. Either can be added behind the same report schema later.

**Persistence and privacy:** reports follow the app's existing rules (this tab session by default, optional 24 h local retention). Audio is never stored, so after a reload the report reopens from storage but the players and download are gone and the report says so. There are no user accounts in this local app: access control is the existing local-only origin/Host check, and a report lives only in the browser that made it.

**Report types and schema.** Every report has a `reportType`: `voice_authenticity`, `scam_analysis`, `noise_analysis`, plus `image_authenticity` and `video_authenticity` for the other media. New reports store it; older saved reports derive it on read (no migration needed): no media or a live session is `scam_analysis`, otherwise the media type decides. New optional fields: `reportType`, `uploadId`, `processing`, and for noise reports a `noise` object (the full report: `speech`, `noise`, `levels`, `clipping`, `silence`, `quality`, `recommendation`, `enhancement`, `evidence`, `limitations`). Existing fields and URLs (`#/incident/<id>`) are unchanged; noise reports use the same URL form. Call dashboards exclude noise reports. History and Call reports have a report-type filter. Export is the existing JSON export and Print/PDF; JSON holds measurements, never audio.

**Tests and evaluation:** `npm test` (the noise tests use real speech from the Windows built-in voices and skip those cases elsewhere). `node tools/evaluate-noise.mjs [--denoise]` prints estimates next to ground truth. `node tools/crawler/noise-e2e.mjs <url>` drives the real UI in a browser.

## Intelligence, Signal, Watermarking and the Chrome extension

- **Intelligence** (`#/intelligence`): for each saved report, shows voice/image/video authenticity, scam intent and transcription as three separate assessments with provider, status, timestamps and processing errors. Scores appear only when the provider returned them.
- **Signal** (`#/signal`): analyzes an audio file in the browser (nothing is uploaded): waveform, spectrogram, pitch, levels, silence, clipping, bandwidth and reliability warnings. These describe audio quality and are not deepfake verdicts.
- **Watermarking** (`#/watermarking`): adds and checks a key-based audio watermark in the browser. It survives WAV copies but not MP3/AAC compression, resampling, trimming or re-recording. Image and video watermarking are not available.
- **Chrome extension** (`extension/`): load it unpacked in `chrome://extensions`, copy its ID into `VOXA_EXTENSION_ID` in `.env.local`, restart VOXA, then right-click media and choose "Check with VOXA". Only that one extension ID may call the analyze API. Extension checks use one scan each and are not saved as VOXA reports.

## Meetings and integrations

- **Meetings** (`#/meetings`) is the "Protect every meeting" page. **Start a meeting** opens a dialog where you paste a Google Meet or Zoom link; VOXA validates it, optionally remembers it, and opens it in a new tab. VOXA never joins the call, hears the meeting or records anyone.
- **Integrations** (`#/integrations`) lists 25 integrations. Google Meet and Zoom work (save, update, remove and open a meeting link) and show **Connected** once a link is saved. All others show **Coming soon**.
- Links are validated in the browser and again on the server with the same rules (`js/meeting-links.js`): only `meet.google.com` and `zoom.us` (and its subdomains) over https, no credentials in the address, no custom ports. They are stored in this browser per workspace user and never on the server.

### Meetings dashboard

Once a meeting link is saved or a meeting is started, **Meetings** becomes a dashboard with Live now, Starting soon, Scheduled and Recently protected tabs. Meetings are ones you start or schedule from VOXA; they are kept in this browser per workspace user. Each meeting can have recordings attached (Analyze recording) and shows the real audio/video verdicts, scam intent and live-monitor sessions for it, with playback while the analyzed file is still available in that tab. VOXA never joins the call, so there is no participant list, and "Live" only means you started the meeting from VOXA.

### Meeting end detection, playback and analysis

- When a meeting is started from VOXA, VOXA keeps a handle to the meeting tab (its link back to VOXA is cut, so the meeting page cannot reach VOXA). When you close that tab the meeting is marked **ended** automatically and the **Meeting ended** step opens. A meeting left live for more than 12 hours is closed automatically. VOXA cannot see inside Google Meet or Zoom, so it cannot detect an ending any other way.
- Google Meet and Zoom do not give VOXA the recording. In the **Meeting ended** step you either add the recording file (it must actually play in the browser; video up to 32 MB, audio up to 20 MB) or use a recording made on this device. You get playback in the page, then **Analyze this recording**, which opens the analysis with the file loaded and tied to the meeting.
- **Record on this device** is opt-in: tick that everyone agreed, choose audio only or audio and video, then pick the meeting tab (with "Also share tab audio") in the browser's own prompt. Nothing records before that. The recording lives in this tab only, stops at the analysis size limit, and is uploaded only when you press Analyze.

### Meeting report

Analyzing a recording that belongs to a meeting, or pressing **Report** / **View intelligence** on a meeting card, opens one report for the whole meeting (`#/meeting/<id>`): scam-intent risk and media-authenticity tiles (kept separate), risk factors, the full conversation with the matched phrases highlighted, the scam-intent graphs, a waveform and spectrogram with audio-quality warnings, playback and a **Download recording** link, live-monitor sessions from the meeting window, and a case file (status, timeline, notes, JSON export, print). Playback, download and the audio graphs work only in the tab that analyzed the file, because VOXA does not store recordings; the transcript, risk and case file persist.
