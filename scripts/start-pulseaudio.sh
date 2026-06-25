#!/usr/bin/env bash
# Ensure PulseAudio is running with a virtual audio device for Daily.co WebRTC.
# Required on headless servers where no physical sound card exists.
# Without this, daily_audio_device_module.cc fails to init recording.

set -euo pipefail

if pulseaudio --check 2>/dev/null; then
    echo "PulseAudio already running"
else
    echo "Starting PulseAudio..."
    pulseaudio --start --exit-idle-time=-1
fi

# Load null sink if not already present
if pactl list short sources 2>/dev/null | grep -q pipecat_loopback; then
    echo "pipecat_loopback sink already loaded"
else
    echo "Loading pipecat_loopback null sink..."
    pactl load-module module-null-sink \
        sink_name=pipecat_loopback \
        sink_properties=device.description=PipecatLoopback
fi

# Create stable symlink so .env PULSE_SERVER path survives PulseAudio restarts
PULSE_NATIVE=$(pactl info 2>/dev/null | grep "Server String:" | awk '{print $NF}')
mkdir -p /tmp/pulse-stable
ln -sf "$PULSE_NATIVE" /tmp/pulse-stable/native
echo "Audio device ready: $(pactl list short sources | grep pipecat_loopback)"
echo "Stable socket: /tmp/pulse-stable/native -> $PULSE_NATIVE"
