import json
import os

def check_user_exists(username: str) -> str:
    # Check if user_list.json exists
    if not os.path.exists('data/user_list.json'):
        return json.dumps({"success": False, "message": "User database not found"})

    try:
        # Read the user list from JSON file - now with explicit UTF-8 encoding
        with open('data/user_list.json', 'r', encoding='utf-8') as file:
            data = json.load(file)

        # Validate that data contains users array
        if not isinstance(data, dict) or 'users' not in data or not isinstance(data['users'], list):
            return json.dumps({"success": False, "message": "Invalid user database format"})

        if(username.lower() == "anonymous"):
            return json.dumps({"success": False, "message": "Can't check anonymous users, please tell me your name."})

        # Check if username exists in the user list (case insensitive)
        if any(user.get('name', '').lower() == username.lower() for user in data['users']):
            return json.dumps({"success": True, "message": "User exists"})
        else:
            return json.dumps({"success": False, "message": "User not found"})

    except json.JSONDecodeError:
        return json.dumps({"success": False, "message": "Error reading user database"})
    except Exception as e:
        return json.dumps({"success": False, "message": f"An error occurred: {str(e)}"})