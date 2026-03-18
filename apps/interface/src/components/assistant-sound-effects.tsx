 'use client';
 
 import { useEffect, useMemo, useRef, useState } from 'react';
 
 import { getClientLogger } from '@interface/lib/client-logger';
 import { useVoiceSessionContext } from '@interface/contexts/voice-session-context';
 
 const log = getClientLogger('[assistant_sound_effects]');
 
 function isBrowser(): boolean {
   return typeof window !== 'undefined';
 }
 
 async function fetchAudioBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer> {
   const res = await fetch(url);
   const arrayBuffer = await res.arrayBuffer();
   return await ctx.decodeAudioData(arrayBuffer);
 }
 
 export function AssistantSoundEffects() {
   const { callStatus } = useVoiceSessionContext();
 
   const [ctx, setCtx] = useState<AudioContext | null>(null);
   const [startBuffer, setStartBuffer] = useState<AudioBuffer | null>(null);
   const [endBuffer, setEndBuffer] = useState<AudioBuffer | null>(null);
 
   const prevCallStatusRef = useRef<typeof callStatus | null>(null);
   // Guard against double-play: custom events + callStatus transitions can both fire
   const recentPlayRef = useRef<number>(0);
 
   const soundUrls = useMemo(() => {
     const swapped = Math.random() > 0.5;
     return {
       start: swapped ? '/sounds/pearl-begins.wav' : '/sounds/pearl-melody.wav',
       end: swapped ? '/sounds/pearl-melody.wav' : '/sounds/pearl-begins.wav',
     };
   }, []);
 
   useEffect(() => {
     if (!isBrowser()) return;
     try {
       const audioCtx = new AudioContext();
       setCtx(audioCtx);
 
       void fetchAudioBuffer(audioCtx, soundUrls.start)
         .then((b) => setStartBuffer(b))
         .catch((err) => log.warn('Failed loading start sound', { error: err instanceof Error ? err.message : String(err) }));
 
       void fetchAudioBuffer(audioCtx, soundUrls.end)
         .then((b) => setEndBuffer(b))
         .catch((err) => log.warn('Failed loading end sound', { error: err instanceof Error ? err.message : String(err) }));
 
       return () => {
         try {
           audioCtx.close();
         } catch {
           // ignore
         }
       };
     } catch (err) {
       log.warn('Failed to create AudioContext', { error: err instanceof Error ? err.message : String(err) });
       return;
     }
   }, [soundUrls.end, soundUrls.start]);
 
   const ensureResumed = async () => {
     if (!ctx) return false;
     if (ctx.state === 'running') return true;
     try {
       await ctx.resume();
       return true;
     } catch (err) {
       log.warn('Failed to resume AudioContext', { error: err instanceof Error ? err.message : String(err) });
       return false;
     }
   };
 
   const play = async (buffer: AudioBuffer | null) => {
    if (!ctx || !buffer) {
      log.debug('Skipping sound play; context or buffer missing', {
        hasContext: !!ctx,
        hasBuffer: !!buffer,
      });
      return;
    }
     const ok = await ensureResumed();
     if (!ok) return;
     const src = ctx.createBufferSource();
     src.buffer = buffer;
     const gain = ctx.createGain();
     gain.gain.value = 0.35;
     src.connect(gain);
     gain.connect(ctx.destination);
     src.start(0);
   };
 
   useEffect(() => {
     if (!isBrowser()) return;
 
     const unlock = () => {
       void ensureResumed();
     };
     window.addEventListener('pointerdown', unlock, { passive: true });
     window.addEventListener('keydown', unlock);
     return () => {
       window.removeEventListener('pointerdown', unlock);
       window.removeEventListener('keydown', unlock);
     };
   }, [ctx]);
 
   useEffect(() => {
     if (!isBrowser()) return;
 
    const onStart = () => {
      log.info('Received assistant:sound:start');
      recentPlayRef.current = Date.now();
      void play(startBuffer);
    };
    const onEnd = () => {
      log.info('Received assistant:sound:end');
      recentPlayRef.current = Date.now();
      void play(endBuffer);
    };
     window.addEventListener('assistant:sound:start', onStart);
     window.addEventListener('assistant:sound:end', onEnd);
     return () => {
       window.removeEventListener('assistant:sound:start', onStart);
       window.removeEventListener('assistant:sound:end', onEnd);
     };
   }, [startBuffer, endBuffer, ctx]);
 
   useEffect(() => {
     const prev = prevCallStatusRef.current;
     prevCallStatusRef.current = callStatus;
 
     if (!prev) return;
 
     // Skip if a custom event already played a sound within the last 2 seconds
     const recentlyPlayed = Date.now() - recentPlayRef.current < 2000;

     const prevInactive = prev === 'inactive' || prev === 'unavailable';
     const nowActiveish = callStatus === 'loading' || callStatus === 'active';
     if (prevInactive && nowActiveish && !recentlyPlayed) {
      log.info('Call transition start sound', { prev, now: callStatus });
       void play(startBuffer);
       return;
     }
 
     const prevActiveish = prev === 'loading' || prev === 'active';
     const nowInactive = callStatus === 'inactive';
     if (prevActiveish && nowInactive && !recentlyPlayed) {
      log.info('Call transition end sound', { prev, now: callStatus });
       void play(endBuffer);
     }
   }, [callStatus, startBuffer, endBuffer, ctx]);
 
   return null;
 }
