import json
import os

def check_phone_number_exists(phone_number: str) -> dict:
    # Check if user_list.json exists
    if not os.path.exists('data/user_list.json'):
        return {"success": False, "message": "User database not found"}

    try:
        # Read the user list from JSON file with UTF-8 encoding
        with open('data/user_list.json', 'r', encoding='utf-8') as file:
            data = json.load(file)

        # Validate that data contains users array
        if not isinstance(data, dict) or 'users' not in data or not isinstance(data['users'], list):
            return {"success": False, "message": "Invalid user database format"}

        if(phone_number.lower() == "anonymous"):
            return {"success": False, "message": "Can't check anonymous users, please tell me your name."}

        # Check if username exists in the user list (case insensitive)
        for user in data['users']:
            if user.get('phone_number', '').lower() == phone_number.lower():
                return {"success": True, "message": "User exists", "user": user}
        return {"success": False, "message": "User not found"}

    except json.JSONDecodeError:
        return {"success": False, "message": "Error reading user database"}
    except Exception as e:
        return {"success": False, "message": f"An error occurred: {str(e)}"}