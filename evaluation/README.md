# Evaluation evidence

VOXA's measured evidence covers two things only.

- **Scam-intent rules.** `npm run evaluate:rules` scores 18 authored transcripts (10 fraud, 8 genuine) at the high-risk threshold. These are fixtures written by the developers, not an independent benchmark. Results are in `rule-results.json`.
- **Genuine human-call accuracy and false-alarm rate: not measured.** No consented human recordings have been scored yet.

## Measure real calls

Create a manifest outside the public assets, one entry per consented recording:

```json
{
  "name": "Consented call set",
  "scope": "Speakers, languages, accents, recording channel and noise",
  "samples": [{
    "id": "call-001",
    "file": "relative/path/to/call.wav",
    "mime": "audio/wav",
    "consent": true,
    "fraud": false,
    "synthetic": false,
    "reference": "A manually verified transcription",
    "language": "Hindi-English",
    "source": "Consented participant, documented consent",
    "detect": true
  }]
}
```

Run `npm run evaluate:audio -- path/to/manifest.json`. Files go to Deepgram and, unless `detect:false`, Sealed Rose, which uses provider credits. The output `evaluation/audio-results.json` contains transcripts, so treat it as sensitive and delete it when no longer needed.

Fraud decision threshold is high risk. `accuracy=(TP+TN)/scorable calls`, `false-alarm rate=FP/(FP+TN)`, `recall=TP/(TP+FN)`.

## Known limitations

- Heuristic request detection can miss paraphrases and indirect coercion, and quoted scam scripts can trigger warnings.
- Background noise, packet loss, accents, overlapping speech, transliteration and recognition errors can hide or invent critical terms.
- Interim live-transcript warnings are provisional and can change.
- Live monitoring hears only audio audible to the permitted microphone, not arbitrary telephone audio.
