# Demo audio samples

VoxShield generates its own demo audio at first startup (see
`app/services/demo_audio_generator.py`), so this folder is populated
automatically — you don't need to add anything to run the demo.

Files:
- `natural.wav`   — synthesized voice with natural pitch variation, jitter, and pauses. Expected: **LOW** risk.
- `synthetic.wav` — flat-pitch, mechanically regular voice. Expected: **HIGH** risk.
- `noisy.wav`      — degraded/mixed characteristics + broadband noise. Expected: **SUSPICIOUS**.

These are synthetic test signals generated with `numpy`/`scipy`, not recordings
of real people — this keeps the prototype self-contained and avoids bundling
any third-party audio.

## Using your own samples instead

If you'd like to demo with real recordings, replace any of the three files
above (keep the same filenames) with your own `.wav` files before starting
the backend, or delete a file and the generator will only recreate the
missing one on next startup — regenerate all three with:

```bash
cd backend
python -m app.services.demo_audio_generator
```
