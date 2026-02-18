# Pipecat Live Test Audio Devices

The Pipecat ↔ Daily live integration harness publishes a synthetic microphone over WebRTC. Browsers and libwebrtc expect *both* a capture and playout device to exist. When neither Loopback/BlackHole (macOS) nor PulseAudio/ALSA loopbacks (Linux) are present, the test aborts before our pipeline boots. This guide explains how to provision virtual audio devices so `tests/integration/test_hello_world.py` can run end-to-end.

The harness automatically inspects your host at runtime:

- **macOS:** looks for "Loopback" or "BlackHole" devices in CoreAudio listings.
- **Linux:** looks for PulseAudio or ALSA sources that expose loopback/monitor channels.

If nothing suitable is found the test will skip with a descriptive message. You can override the check (e.g., on CI where you know devices exist) by exporting `PIPECAT_SKIP_AUDIO_DEVICE_CHECK=1`.

---

## macOS Setup

### Option A — BlackHole (free, open source)

```bash
# Install from Homebrew (needs the cask tap)
brew install --cask blackhole-2ch

# Verify
SwitchAudioSource -a | grep -i "blackhole"
```

After installation, open **Audio MIDI Setup** and create a **Multi-Output Device** that includes both your physical speakers and "BlackHole 2ch". Set that multi-output device as the system output so you can still hear audio locally while the harness mirrors it to BlackHole.

### Option B — Rogue Amoeba Loopback (paid, best UX)

1. Install [Loopback](https://rogueamoeba.com/loopback/).
2. Create a new virtual device named `Pipecat Loopback` with your preferred microphone as a source.
3. (Optional) Add a monitor so you can hear the call while the harness captures it.

### Validation (macOS)

```bash
# Either command emits the full CoreAudio catalog.
SwitchAudioSource -a | grep -i "loopback"
system_profiler SPAudioDataType | grep -i "blackhole"
```

If you see the device name, the harness check will pass.

---

## Linux Setup

You need either PulseAudio (default on most desktops) or ALSA loopback modules enabled.

### PulseAudio Null Sink + Monitor

```bash
# Load a null sink that exposes a monitor source for capture
pactl load-module module-null-sink sink_name=pipecat_loopback sink_properties=device.description=PipecatLoopback

# (Optional) Route the monitor into your default output so you can listen
pactl load-module module-loopback sink=alsa_output.pci-0000_00_1b.0.analog-stereo source=pipecat_loopback.monitor

# Confirm a monitor source exists
pactl list short sources | grep -i pipecat_loopback
```

Persist these `pactl` commands by adding them to `~/.config/pulse/default.pa` or your distro's equivalent.

### ALSA Loopback Module

```bash
# Enable the snd-aloop module
sudo modprobe snd-aloop

# Verify the capture/playback devices
arecord -l | grep -i loopback
aplay -l   | grep -i loopback
```

To load the module at boot, add `snd-aloop` to `/etc/modules-load.d/snd-aloop.conf`.

### Validation (Linux)

```bash
pactl list short sources | grep -i monitor
arecord -l | grep -i loopback
```

If at least one monitor/loopback line is printed, the harness check will succeed.

---

## Troubleshooting

- **Need to bypass temporarily?** Set `PIPECAT_SKIP_AUDIO_DEVICE_CHECK=1` before running pytest. The harness will still need working devices, so expect libwebrtc to crash if they are missing.
- **Custom device names?** Export `PIPECAT_AUDIO_DEVICE_HINT="My Virtual Mic"` so the detector looks for your exact device label when it does not contain "BlackHole" or "Loopback".
- **CI runners:** Provision devices via container modules (PulseAudio virtual sinks or ALSA loopback) and export `PIPECAT_SKIP_AUDIO_DEVICE_CHECK=1` once you know the setup is correct.
- **Still failing?** Re-run the validation commands above and include their output when filing an issue.

With a loopback device in place, re-run:

```bash
cd apps/pipecat-daily-bot/bot
poetry run pytest tests/integration/test_hello_world.py -q
```

You should now see the test execute (or skip for missing Daily credentials) instead of aborting because of missing audio hardware.
