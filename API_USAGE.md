# API usage and free-mode policy

VOXA is built to run on free resources. **`FREE_MODE` is on by default**: the server refuses to call any external provider until you confirm, in `.env.local`, that its account has no payment method or auto top-up. A blocked call fails before any network request, and the app shows "Blocked by FREE_MODE" with the fix.

```
FREE_MODE=1                                   # default; set 0/off to disable the guard
FREE_MODE_CONFIRMED=realitydefender,deepgram  # providers you have verified are card-free
```

Pricing below was read from each provider's official page or documentation on 14 Oct 2026. Pricing changes: re-check before relying on it. Nothing here enables billing, and VOXA never buys credits.

| Provider | Used for | Free today? | Limits | Card needed? | Env variable |
|---|---|---|---|---|---|
| **Reality Defender** | Deepfake detection, voice and image (primary) | Yes, free API plan | 50 scans a month, audio and image only, one seat. Audio up to 20 MB (wav, mp3, flac, ogg, m4a, aac), image up to 50 MB. Video needs a sales agreement. | Not at sign-up. Launch post mentions usage-based pricing beyond 50 scans; confirm your account cannot overage. | `REALITY_DEFENDER_API_KEY` |
| **Sealed Rose** | Video detection (12 credits each); optional voice/image detector | Trial only: 25 test credits, then prepaid packs ($2.99 for 60). | Image, audio, text 1 credit; video 12. Media up to 32 MB. Empty balance returns HTTP 402. | Not stated for the trial. | `SEALEDROSE_API_KEY` |
| **Deepgram** | Speech to text (Nova-3, `language=multi`), live monitor | One-time $200 credit, no expiry. Not a permanent free tier. | Pre-recorded about $0.0052 per minute after credit; streaming about $0.0058 per minute. | Not for the credit. Auto top-up exists, so keep it off. | `DEEPGRAM_API_KEY` |
| **Gemini API** | Text extraction fallback, "Intelligence results" (transcript text only) | Yes, `gemini-2.5-flash` lists a free tier. | Rate limits are set per project in AI Studio. | Free only while the Google project has billing disabled. | `GEMINI_API_KEY`, `GEMINI_MODEL` |
| **Luxand** | Optional face liveness for portrait photos | Unverified: third-party listings say 500 free requests a month; the official pricing page could not be loaded. | Unverified. | Unverified. | `LUXAND_API_KEY` |

## Privacy and retention

- **Reality Defender**: files are uploaded to its storage and analysed. Check its data-retention terms before sending real calls.
- **Sealed Rose**: states uploaded media is discarded after analysis and not used for training; check metadata (verdict, cost) is kept.
- **Deepgram**: VOXA sends `mip_opt_out=true`, which opts out of model improvement.
- **Gemini free tier**: Google's pricing page says free-tier content **is used to improve Google products**. Do not send real customer call transcripts through Gemini on the free tier. Prefer Deepgram for transcription; use Gemini only for non-sensitive text.
- VOXA itself keeps raw media in memory (and a private temp folder for FFmpeg, deleted after each request). Reports stay in the browser tab unless you opt into 24-hour local retention.

## Free local tools in use

- **FFmpeg** (`ffmpeg-static`, free, GPL-3.0): validates video and audio, extracts a 16 kHz mono WAV from video, converts WebM microphone recordings for Reality Defender. Override with `FFMPEG_PATH`.
- **Fraud-intent rules**: run locally in the browser, no API.

## Free fallbacks not yet built

- **faster-whisper** (local speech to text, https://github.com/SYSTRAN/faster-whisper): not installed on this machine and not wired in. A `base` or `small` model fits 8 GB RAM. This is the best free replacement for Deepgram and Gemini transcription.
- **Hugging Face audio-classification models** for local voice deepfake detection: not evaluated. Check each model card's licence, labels and measured accuracy first; torch is installed (CPU) but models are not.

## How to disable or replace a provider

Remove its key from `.env.local` (or leave it out of `FREE_MODE_CONFIRMED`). The feature then shows "Not configured" or "Blocked by FREE_MODE" and nothing is called. Set `AUTH_PROVIDER=sealedrose` to switch the detector. Provider choice follows configuration, never failure: VOXA does not silently fall back to a different detector.

## Costs VOXA can still incur

Each analysis uses one scan or credit per detector call (video 12 Sealed Rose credits; the optional soundtrack check adds one more). Reality Defender's 50-scan month is shared with everything you test.
