import os
import json
from functions.send_response_to_user import send_response_to_user

def send_message(message: str, username: str) -> str:
    """
    Send a message to a user in the user list (if username is not provided, ask for it) dont send message to yourself, if message is not provided, ask for it ( don't assume anything )

    Args:
        message (str): The message to send (if message is not provided, ask for it)
        username (str): The name of the user to send the message to (if username is not provided, ask for it)

    Returns:
        str: A string with the message
    """

    try:
        # Check if message is provided
        if not message:
            return json.dumps({
                "status": False,
                "message": "Message not provided"
            })

        # Check if username is provided
        if not username:
            return json.dumps({
                "status": False,
                "message": "Username not provided"
            })

        # Load user list from JSON file with UTF-8 encoding
        with open('data/user_list.json', 'r', encoding='utf-8') as f:
            user_data = json.load(f)

        # Find target user by username
        target_user = None
        for user in user_data['users']:
            if user['name'].lower() == username.lower():
                target_user = user
                break

        if not target_user:
            return json.dumps({
                "status": False,
                "message": "User not found"
            })

        phone_number = f"{target_user['phone_number']}"
    
        message_response = send_response_to_user(phone_number, message)

        if message_response.get("success", False):
            return json.dumps({
                "status": True,
                "message": f"Message sent to {target_user['name']}",
                "message_sid": message_response.get("message_sid", None)
            })
        else:
            return json.dumps({
                "status": False,
                "message": message_response.get("message", "Failed to send message")
            })

    except Exception as e:
        return json.dumps({
            "status": False,
            "message": str(e),
            "message_sid": None
        })
