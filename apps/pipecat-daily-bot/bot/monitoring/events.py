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
        parent_self = self
        
        class SpeakingMonitor(parent_self._FrameProcessor):
            def __init__(self, **kwargs):
                super().__init__(**kwargs)
                self._is_speaking = False
                self._accumulated_text = ""  # Track text for this speaking turn
            
            async def process_frame(self, frame, direction):
                await super().process_frame(frame, direction)
                
                # Emit speaking started event on first TTS started frame
                if isinstance(frame, parent_self._TTSStartedFrame):
                    if not self._is_speaking:
                        self._is_speaking = True
                        self._accumulated_text = ""  # Reset accumulated text
                        try:
                            from eventbus import emit_bot_speaking_started
                            emit_bot_speaking_started(parent_self._room_url)
                        except Exception:
                            pass
                
                # Capture TTSTextFrame - this contains the sentence text being spoken
                elif parent_self._TTSTextFrame and isinstance(frame, parent_self._TTSTextFrame):
                    text = getattr(frame, 'text', None) or ''
                    if text:
                        # Add space between sentences if accumulating
                        if self._accumulated_text and not self._accumulated_text.endswith(' '):
                            self._accumulated_text += ' '
                        self._accumulated_text += text
                        try:
                            from eventbus import emit_bot_transcript
                            # Emit accumulated transcript with isFinal=False
                            # This ensures the frontend sees the full text so far,
                            # not just individual chunks which appear out of order
                            emit_bot_transcript(
                                parent_self._room_url, 
                                text=self._accumulated_text,
                                is_final=False
                            )
                        except Exception:
                            pass
                
                # Emit speaking stopped event when TTS stops
                elif isinstance(frame, parent_self._TTSStoppedFrame):
                    if self._is_speaking:
                        self._is_speaking = False
                        try:
                            from eventbus import emit_bot_speaking_stopped, emit_bot_transcript
                            # Emit final transcript marker
                            if self._accumulated_text:
                                emit_bot_transcript(
                                    parent_self._room_url,
                                    text=self._accumulated_text,
                                    is_final=True
                                )
                            emit_bot_speaking_stopped(parent_self._room_url)
                        except Exception:
                            pass
                        self._accumulated_text = ""
                
                # Pass frame through unchanged
                await self.push_frame(frame, direction)
        
        return SpeakingMonitor()
