import json
import os
import uuid
from datetime import datetime
from utils.history_manager import HistoryManager

def register_user(username: str, password: str, phone_number: str, interests: list) -> str:

    # Create user data structure
    new_user = {
        "name": username,
        "passPhrase": password,
        "phone_number": phone_number,
        "interests": interests,
        "messages": [],
        "eventHistory": [],
        "chatHistory": [],
        "_id": str(uuid.uuid4()).replace('-', '')[:24],
        "createdAt": datetime.now().isoformat(),
        "updatedAt": datetime.now().isoformat(),
        "__v": 0
    }

    user_file_path = "data/user_list.json"

    # Create data directory if it doesn't exist
    os.makedirs(os.path.dirname(user_file_path), exist_ok=True)

    try:
        # Load existing users
        if os.path.exists(user_file_path):
            with open(user_file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                users = data.get("users", [])
        else:
            users = []
            data = {"users": users}

        # Check if username already exists
        if any(user['name'] == username for user in users):
            return json.dumps({"success": False, "message": "Username already exists"})

        # Add new user
        users.append(new_user)
        data["users"] = users

        # Save updated user list
        with open(user_file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4, ensure_ascii=False)

        # Migrate temporary chat history if exists
        history_manager = HistoryManager(phone_number=phone_number)
        history_manager.migrate_temp_history()

        return json.dumps({"success": True, "message": "User registered successfully"})

    except Exception as e:
        return json.dumps({"success": False, "message": f"Registration failed: {str(e)}"})




