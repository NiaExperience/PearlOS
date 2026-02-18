import json
from pathlib import Path

def login_user(username: str, password: str) -> str:
    # Check if user_list.json exists
    user_file_path = Path("data/user_list.json")
    if not user_file_path.exists():
        return json.dumps({"success": False, "message": "User database not found"})

    try:
        # Read the user list from JSON file with UTF-8 encoding
        with open(user_file_path, "r", encoding='utf-8') as file:
            data = json.load(file)
            users = data.get("users", [])  # Get users array from the root object

        # Search for user (case insensitive username comparison)
        for user in users:
            if user.get("name", "").lower() == username.lower():
                # Check password
                if user.get("passPhrase", "").lower() == password.lower():
                    return json.dumps({"success": True, "message": "User logged in successfully."})
                else:
                    return json.dumps({"success": False, "message": "Invalid password"})

        # If we get here, user was not found
        return json.dumps({"success": False, "message": "User not found"})

    except json.JSONDecodeError:
        return json.dumps({"success": False, "message": "Invalid user database format"})
    except Exception as e:
        return json.dumps({"success": False, "message": f"An unexpected error occurred: {str(e)}"})