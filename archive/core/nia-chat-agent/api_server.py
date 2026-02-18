from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from dotenv import load_dotenv
from core.assistant import Assistant
import os
import json
import logging
import traceback

logger = logging.getLogger(__name__)
# Load environment variables from .env file
load_dotenv()

from core.phone_conversation import PhoneConversationHandler
import uvicorn
from typing import List, Dict
from functions.check_phone_number_exists import check_phone_number_exists
from functions.send_response_to_user import send_response_to_user

app = FastAPI()

@app.post("/api/chat")
async def process_chat(request: Request):
    print(f"Chat request: {request}")
    logger.info(f"Chat request: {request}")
    try:
        body = await request.json()

        user_phone_number = body.get("from");
        assistant_phone_number = body.get("to");
        message = body.get("message");        

        print(f"User phone number: {user_phone_number}")
        print(f"Assistant phone number: {assistant_phone_number}")
        print(f"Message: {message}")    

        if (user_phone_number is None):
            raise HTTPException(status_code=400, detail="Phone number is required")
        if (assistant_phone_number is None):
            raise HTTPException(status_code=400, detail="Assistant phone number is required")
        if (message == ""):
            raise HTTPException(status_code=400, detail="Message is required")

        handler = PhoneConversationHandler(
            assistant_phone_number=clean_phone_number(assistant_phone_number),
            user_phone_number=clean_phone_number(user_phone_number),
        )
        
        if (handler is None):
            print("User not found. This endpoint requires a user to exist. Please hit /message first to create a user.")
            raise HTTPException(status_code=400, detail="User not found. This endpoint requires the user to exist (did you mean to hit /api/message?)")

        # Process the message
        response = handler.handle_conversation(message)
        message_sid = send_response_to_user(assistant_phone_number, user_phone_number, response)
        print(f"Message sid: {message_sid}")
        return {
            "response": "success",
            "message": response,
            "data": {
                "message_sid": message_sid,
            }
        }
    except Exception as e:
        print(f"Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/message")
async def process_message(request: Request):
    try:
        body = await request.json()

        params = body.get("message", {}).get("functionCall", {}).get("parameters", {})

        assistant_phone_number = params.get("assistant_phone_number")
        user_phone_number = params.get("user_phone_number")
        message = params.get("message")

        print(f"Params: {params}")
        print(f"User phone number: {user_phone_number}")
        print(f"Assistant phone number: {assistant_phone_number}")
        print(f"Message: {message}")    

        assistant_phone_number = clean_phone_number(assistant_phone_number)
        user_phone_number = clean_phone_number(user_phone_number)
        print(f"Cleaned user phone number: {user_phone_number}")
        print(f"Cleaned assistant phone number: {assistant_phone_number}")

        message_sid = send_response_to_user(assistant_phone_number, user_phone_number, message)

        print(f"Message sid: {message_sid}")
        # Return response in Twilio's expected format
        return {
            "response": "success",
            "message": message,
            "data": {
                "message_sid": message_sid,
                "message": [{
                    "text": message,
                }]
            }
        }
    except Exception as e:
        import traceback
        print(f"Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# TODO: Move this into the PhoneConversationHandler class
def clean_phone_number(phone_number):
    is_whatsapp_message = phone_number.startswith("whatsapp:") if phone_number else False
    if is_whatsapp_message:
        phone_number = phone_number.replace("whatsapp:", "")
        phone_number_without_country_code = phone_number.replace("+91", "")
    else:
        phone_number_without_country_code = phone_number.replace("+1", "")

    if is_whatsapp_message:
        phone_number = f"whatsapp:{phone_number}"

    # Make sure the phone number is in the format of a 10 digit number, including any leading 1
    phone_number = phone_number.replace("+1", "").replace(" ", "").replace("-", "")
    
    if phone_number.startswith("1") and len(phone_number) == 11:
        phone_number = phone_number[1:]

    if len(phone_number) != 10:
        raise ValueError("Phone number must be a 10 digit number")

    return phone_number_without_country_code
    

def pull_chat_history(payload_obj):
    return payload_obj['message']['artifact']['messages']

def pull_assistant_model(payload_obj):
    return payload_obj["message"]["call"]["assistant"]["model"]

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))  # Get port from env var, default to 8000
    uvicorn.run(app, host="localhost", port=port)
