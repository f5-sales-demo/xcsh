Display rich media in the transcript.

Pass exactly one of:

- `source`: a local path, `artifact://` source, session/tool artifact, or HTTPS URL.
- `frames`: ordered text frames or raster-frame sources with per-frame `durationMs`.

Playback is always muted. Autoplay defaults to once, looping is opt-in, and playback is capped at 12 FPS unless a lower or higher cap (up to 60) is requested. Unsupported terminals and missing FFmpeg receive a static poster or text fallback.
