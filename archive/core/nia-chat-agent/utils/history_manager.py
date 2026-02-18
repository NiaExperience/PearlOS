import json
from datetime import datetime
from utils.auth_manager import AuthManager
from .message_formatter import format_history_for_storage

class HistoryManager:
    """Manages conversation history in memory."""

    def __init__(self, phone_number=None):
        """Initialize with optional phone number."""
        self.phone_number = phone_number
        self.messages = []

    def get_current_messages(self):
        """Get current messages."""
        return self.messages

    def add_message(self, message):
        """Add a message to the current conversation."""
        # Don't format if already formatted
        if isinstance(message, dict) and "role" in message:
            self.messages.append(message)
        else:
            formatted_message = format_history_for_storage(message)
            self.messages.append(formatted_message)

    def clear_current_conversation(self):
        """Clear the current conversation."""
        self.messages = []
        