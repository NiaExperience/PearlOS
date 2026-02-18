TOOLS_CONFIG = {
    'tools': [
        {
            "name": "check_user_exists",
            "description": "Check if a user exists in the system",
            "parameters": {
                "type": "object",
                "properties": {
                    "username": {
                        "type": "string",
                        "description": "Username to check"
                    }
                },
                "required": ["username"]
            }
        },
        {
            "name": "register_user",
            "description": "Register a new user",
            "parameters": {
                "type": "object",
                "properties": {
                    "username": {
                        "type": "string",
                        "description": "Username for registration"
                    },
                    "password": {
                        "type": "string",
                        "description": "Password for registration"
                    },
                    "phone_number": {
                        "type": "string",
                        "description": "Phone number of the user"
                    },
                    "interests": {
                        "type": "string",
                        "description": "User's interests"
                    }
                },
                "required": ["username", "password", "phone_number", "interests"]
            }
        },
        {
            "name": "send_message",
            "description": "Send a message to another user",
            "parameters": {
                "type": "object",
                "properties": {
                    "username": {
                        "type": "string",
                        "description": "Username of the recipient"
                    },
                    "message": {
                        "type": "string",
                        "description": "Message content to send"
                    }
                },
                "required": ["username", "message"]
            }
        }
    ]
}