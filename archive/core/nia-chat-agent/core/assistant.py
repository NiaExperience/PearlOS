import json
import os

from groq import Groq

from config.tools_config import TOOLS_CONFIG
from functions.check_user_exists import check_user_exists
from functions.currency_ops import convert_currency
from functions.file_ops import file_operations
from functions.note_ops import notes_manager
from functions.register_user import register_user
from functions.send_message import send_message
from functions.system_ops import process_manager, system_info
from functions.weather_ops import get_weather
from utils.history_manager import HistoryManager 

class Assistant:
    def __init__(self, assistant_model):
        self._client = Groq(api_key=os.getenv("GROQ_API_KEY"))

        # Use the model info from JSON, fallback to default if not provided
        # TODO: We are using llama-3.3-70b-versatile for now, but we should use the model from the JSON
        # (it is currently giving me "'The model `gpt-4o-mini` does not exist or you do not have access to it")
#        self._model = assistant_model.get("model", "llama-3.3-70b-versatile")
        self._model = "llama-3.3-70b-versatile"
        self._system_message = assistant_model.get("systemPrompt", "You are a helpful assistant.")

        # Wrap raw function specs in the required "tools" format
        raw_functions = assistant_model.get("functions", [])
        self._tools = [
            {
                "type": "function",
                "function": fn
            }
            for fn in raw_functions
        ]

        self._available_functions = {
            "file_operations": file_operations,
            "system_info": system_info,
            "process_manager": process_manager,
            "get_weather": get_weather,
            "convert_currency": convert_currency,
            "notes_manager": notes_manager,
            "check_user_exists": check_user_exists,
            "register_user": register_user,
            "send_message": send_message,
        }

        self._history_manager = HistoryManager()

    @property
    def client(self):
        return self._client

    @property
    def model(self):
        return self._model

    @property
    def available_functions(self):
        return self._available_functions

    @property
    def system_message(self):
        return self._system_message

    def get_current_messages(self):
        """Get current messages from the history manager."""
        return self._history_manager.get_current_messages()

    def load_messages(self, messages):
        """Load messages into the history manager."""
        self._history_manager.messages = messages

    def get_all_tools(self):
        all_tools = []
        for tool_list in TOOLS_CONFIG.values():
            for fn in tool_list:
                all_tools.append({
                    "type": "function",
                    "function": fn
                })
        return all_tools

    def add_to_history(self, message):
        self._history_manager.add_message(message)

    def set_history(self, messages):
        self._history_manager.messages = messages

    def clear_history(self):
        self._history_manager.clear_current_conversation()
