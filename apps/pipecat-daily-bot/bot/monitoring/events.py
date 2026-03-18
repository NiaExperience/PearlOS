class TTSSpeakingEventProcessor:
    """
    Processor that monitors TTS frames and emits bot speaking events to the eventbus.
    This enables the frontend to sync lipsync animations with actual bot speech,
    and streams bot transcript text in real-time as sentences are spoken.
    
    Monitors TTS frames and emits:
    - bot.speaking.started/stopped events for lipsync
    - bot.transcript events for real-time transcript display
    """
    def __init__(self, room_url: str):
        from pipecat.processors.frame_processor import FrameProcessor
        from pipecat.frames.frames import (
            Frame,
            TTSStartedFrame,
            TTSStoppedFrame,
            TTSAudioRawFrame,
        )
        # TTSTextFrame contains the actual text being spoken (sentence-aggregated)
        try:
            from pipecat.frames.frames import TTSTextFrame
        except ImportError:
            TTSTextFrame = None
        
        self._room_url = room_url
        self._is_speaking = False
        self._FrameProcessor = FrameProcessor
        self._TTSStartedFrame = TTSStartedFrame
        self._TTSStoppedFrame = TTSStoppedFrame
        self._TTSAudioRawFrame = TTSAudioRawFrame
        self._TTSTextFrame = TTSTextFrame
        
    def create_processor(self):
        """Create and return the frame processor instance."""
        import asyncio
        parent_self = self
        # Debounce window: delay stop events so rapid TTS chunk boundaries
        # (TTSStarted→TTSStopped→TTSStarted…) don't flood the frontend with
        # speaking state changes.  If a new TTSStartedFrame arrives within this
        # window the pending stop is cancelled and speaking stays continuous.
        _STOP_DEBOUNCE_S = 0.4  # 400ms — covers typical inter-chunk gaps
        
        class SpeakingMonitor(parent_self._FrameProcessor):
            def __init__(self, **kwargs):
                super().__init__(**kwargs)
                self._is_speaking = False          # True while we've emitted "started" to eventbus
                self._tts_active_depth = 0         # Count of nested TTS started/stopped pairs
                self._accumulated_text = ""        # Track text for this speaking turn
                self._stop_debounce_task: asyncio.Task | None = None
            
            def _cancel_pending_stop(self):
                if self._stop_debounce_task and not self._stop_debounce_task.done():
                    self._stop_debounce_task.cancel()
                    self._stop_debounce_task = None

            async def _debounced_stop(self):
                """Wait, then emit the actual speaking-stopped event."""
                try:
                    await asyncio.sleep(_STOP_DEBOUNCE_S)
                except asyncio.CancelledError:
                    return  # A new TTSStartedFrame arrived — stay speaking
                # Still no new TTS chunk after the debounce window → actually stop
                if self._tts_active_depth <= 0:
                    self._is_speaking = False
                    self._tts_active_depth = 0
                    try:
                        from eventbus import emit_bot_speaking_stopped, emit_bot_transcript
                        if self._accumulated_text:
                            emit_bot_transcript(
                                parent_self._room_url,
                                text=self._accumulated_text,
                                is_final=True,
                            )
                        emit_bot_speaking_stopped(parent_self._room_url)
                    except Exception:
                        pass
                    self._accumulated_text = ""

            async def process_frame(self, frame, direction):
                await super().process_frame(frame, direction)
                
                # Emit speaking started event on first TTS started frame
                if isinstance(frame, parent_self._TTSStartedFrame):
                    self._tts_active_depth += 1
                    # Cancel any pending debounced stop — we're still speaking
                    self._cancel_pending_stop()
                    if not self._is_speaking:
                        self._is_speaking = True
                        self._accumulated_text = ""
                        try:
                            from eventbus import emit_bot_speaking_started
                            emit_bot_speaking_started(parent_self._room_url)
                        except Exception:
                            pass
                
                # Capture TTSTextFrame - this contains the sentence text being spoken
                elif parent_self._TTSTextFrame and isinstance(frame, parent_self._TTSTextFrame):
                    text = getattr(frame, 'text', None) or ''
                    if text:
                        if self._accumulated_text and not self._accumulated_text.endswith(' '):
                            self._accumulated_text += ' '
                        self._accumulated_text += text
                        try:
                            from eventbus import emit_bot_transcript
                            emit_bot_transcript(
                                parent_self._room_url, 
                                text=self._accumulated_text,
                                is_final=False
                            )
                        except Exception:
                            pass
                
                # Debounced speaking stopped — wait for inter-chunk gap to close
                elif isinstance(frame, parent_self._TTSStoppedFrame):
                    self._tts_active_depth = max(0, self._tts_active_depth - 1)
                    if self._is_speaking and self._tts_active_depth <= 0:
                        # Don't emit stop immediately — schedule a debounced stop
                        self._cancel_pending_stop()
                        loop = asyncio.get_event_loop()
                        self._stop_debounce_task = loop.create_task(self._debounced_stop())
                
                # Pass frame through unchanged
                await self.push_frame(frame, direction)
        
        return SpeakingMonitor()
