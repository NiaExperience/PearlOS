import pytest
from unittest.mock import AsyncMock, patch
try:
    from bot.processors.lull import create_lull_processor
except ImportError:
    from processors.lull import create_lull_processor
from pipecat.frames.frames import LLMRunFrame

@pytest.mark.asyncio
async def test_lull_processor_callback_logic():
    """Test that the lull callback updates messages and queues an LLM run."""
    messages = []
    timeout = 10.0

    # Patch UserIdleProcessor to capture the callback
    with patch('bot.processors.lull.UserIdleProcessor') as MockProcessor:
        mock_proc_instance = MockProcessor.return_value
        mock_proc_instance.queue_frame = AsyncMock()

        # Instantiate
        create_lull_processor(messages, timeout)

        # Verify constructor call
        args, kwargs = MockProcessor.call_args
        assert 'callback' in kwargs
        callback = kwargs['callback']
        assert kwargs['timeout'] == timeout

        # Execute the captured callback
        await callback(mock_proc_instance)

        # Verify message append
        assert len(messages) == 1
        assert messages[0]['role'] == 'system'
        assert f"silent for {int(timeout)}" in messages[0]['content']

        # Verify LLM trigger
        assert mock_proc_instance.queue_frame.called
        frame = mock_proc_instance.queue_frame.call_args[0][0]
        assert isinstance(frame, LLMRunFrame)

@pytest.mark.asyncio
async def test_lull_processor_debounce():
    """Test that the lull callback debounces rapid calls."""
    messages = []
    timeout = 10.0

    with patch('bot.processors.lull.UserIdleProcessor') as MockProcessor:
        mock_proc_instance = MockProcessor.return_value
        mock_proc_instance.queue_frame = AsyncMock()

        create_lull_processor(messages, timeout)
        callback = MockProcessor.call_args[1]['callback']

        # First call: should trigger
        await callback(mock_proc_instance)
        assert len(messages) == 1
        assert mock_proc_instance.queue_frame.call_count == 1

        # Second call immediately: should be debounced (ignored)
        await callback(mock_proc_instance)
        assert len(messages) == 1
        assert mock_proc_instance.queue_frame.call_count == 1
