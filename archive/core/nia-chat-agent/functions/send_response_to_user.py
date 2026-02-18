import os
import json
import requests
import logging

logger = logging.getLogger(__name__)

def send_response_to_user(assistant_phone_number: str, user_phone_number: str, message: str) -> dict:
    api_key = os.getenv("SIGNALMASH_API_KEY", "jqLuS1VMZIFDHxyqUrQgqZdM0IpJ6l")  # Default to the provided key or use from env

    try:
        logger.info(f"Assistant phone number: {assistant_phone_number}")
        logger.info(f"User phone number: {user_phone_number}")
        logger.info(f"Sending response to user: {message}")
        
        # Make a request to the Signalmash API using the format from the curl command
        payload = {
            "FROM": assistant_phone_number,
            "TO": user_phone_number,
            "BODY": message,
        }
        logger.info(f"Request payload: {payload}")
        response = requests.post(
            "https://api.signalmash.com/sms",
            headers={
                "accept": "*/*",
                "Authorization": api_key,
                "Content-Type": "application/x-www-form-urlencoded"
            },
            data=payload
        )
        
        response_data = response.json() if response.text else {}
        
        logger.info(f"Message sent: {response.status_code}")
        logger.info(f"Response: {response_data}")
        
        return {
            "success": response.status_code == 200,
            "message": "Message sent",
            "message_sid": response_data.get("batch_id", None)
        }
    except Exception as e:
        logger.error(f"Error sending message: {e}")
        return {
            "success": False,
            "message": str(e)
        }
