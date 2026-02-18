import json
import os
from pathlib import Path

class AuthManager:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(AuthManager, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self._initialized = True
        self.current_user = {
            "_id": "1",
            "name": "test",
            "passPhrase": "test",
            "phone_number": "1234567890",
            "interests": "test"
        }
        self.user_list = []
        try:
            file_path = Path("data/user_list.json")
            if file_path.exists():
                with open(file_path, "r", encoding='utf-8') as f:
                    self.user_list = json.load(f)["users"]
        except Exception as e:
            print(f"Error loading user list: {e}")
            self.user_list = []

    def get_user_list(self):
        return self.user_list

    def set_current_user(self, user: dict):
        # Create a deep copy of the user dict to prevent reference issues
        self.current_user = dict(user)

    def get_current_user(self):
        return self.current_user

    def get_user(self, username: str):
        for user in self.user_list:
            if user['name'].lower() == username.lower():
                return user
        return None

    def add_user(self, user: dict):
        self.user_list.append(user)
        self._save_user_list()

    def remove_user(self, username: str):
        self.user_list = [user for user in self.user_list if user['name'].lower() != username.lower()]
        self._save_user_list()

    def authenticate(self, username: str, password: str) -> bool:
        for user in self.user_list:
            if user['name'].lower() == username.lower() and user['passPhrase'].lower() == password.lower():
                self.set_current_user(user)
                return True
        return False

    def _save_user_list(self):
        try:
            os.makedirs("data", exist_ok=True)
            with open("data/user_list.json", "w", encoding='utf-8') as f:
                json.dump({"users": self.user_list}, f, indent=4, ensure_ascii=False)
        except Exception as e:
            print(f"Error saving user list: {e}")