import json
import os

from core.assistant_manager import assistantForPhoneNumber
from core.conversation import ConversationHandler

class PhoneConversationHandler (ConversationHandler):
    """Handles conversations specifically for phone/SMS interactions."""
    
    def __init__(self, assistant_model=None, assistant_phone_number=None, user_phone_number=None):
        if (assistant_phone_number is None or user_phone_number is None):
            raise ValueError("Both assistant phone number and user phone number are required")

        self.assistant_phone_number = assistant_phone_number  # Store this for save_user_data
        # Load user data from phone-specific JSON file
        user_data = self._load_user_data(assistant_phone_number, user_phone_number)

        if assistant_model is None:
            assistant_model = assistantForPhoneNumber(assistant_phone_number)
            if (assistant_model is None):
                raise ValueError("Assistant model is not set, cannot create new user data")

        if (user_data is None):
            print("User data not found, creating new user data")
            user_data = { "assistant_model": assistant_model }
        else:
            print("User data found, loading existing user data")
            user_data["assistant_model"] = assistant_model

        super().__init__(phone_number=user_phone_number, user_data=user_data)

    def _get_user_data_path(self, assistant_phone_number, user_phone_number):
        return f"data/{assistant_phone_number}/{user_phone_number}.json"

    def _load_user_data(self, assistant_phone_number, user_phone_number):
        """Load user data from phone-specific JSON file."""
        if not user_phone_number or not assistant_phone_number:
            print("Loading user data: Phone number or assistant number is missing")
            return None
            
        user_json_path = self._get_user_data_path(assistant_phone_number, user_phone_number)        

        if os.path.exists(user_json_path):
            print("User json path exists")
            with open(user_json_path, 'r', encoding='utf-8') as f:
                user_data = json.load(f)
                return user_data

        return None

    def save_user_data(self):
        user_data = self.construct_user_data()

        """Save current user data to phone-specific JSON file."""
        if not self.assistant_phone_number or not self.phone_number:
            print("Saving user data: Crucial fields are missing")
            return
            
        user_json_path = f"data/{self.assistant_phone_number}/{self.phone_number}.json" 
        os.makedirs(os.path.dirname(user_json_path), exist_ok=True)
        with open(user_json_path, 'w', encoding='utf-8') as f:
            json.dump(user_data, f, indent=2, ensure_ascii=False)

    def handle_conversation(self, user_prompt: str):
        response = super().handle_conversation(user_prompt)
        self.save_user_data()
        return response

