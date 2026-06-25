type UnlockResult = 'success' | 'blocked' | 'unsupported';

type WindowWithWebkitAudioContext = Window & {
  webkitAudioContext?: typeof AudioContext;
};

export async function unlockAudioPlayback(
  audioEl?: HTMLAudioElement | null,
): Promise<UnlockResult> {
  if (typeof window === 'undefined') {
    return 'unsupported';
  }

  try {
    const AudioContextCtor =
      window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;
    if (AudioContextCtor) {
      const audioContext = new AudioContextCtor();
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      void audioContext.close();
    }

    if (!audioEl) {
      return 'success';
    }

    if (!audioEl.srcObject) {
      audioEl.srcObject = new MediaStream();
    }
    audioEl.muted = false;
    await audioEl.play();
    return 'success';
  } catch {
    return 'blocked';
  }
}
