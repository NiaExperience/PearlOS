import json
import os
from typing import Any, Dict, Optional

from bson import json_util
from dotenv import load_dotenv
from pymongo import MongoClient

# Load environment variables
load_dotenv()

def assistantForPhoneNumber(phone_number: str) -> Optional[Dict[Any, Any]]:
    try:
        # Assuming you have MongoDB connection details in environment variables
        client = MongoClient(os.getenv('DATABASE_URL'))
        db = client[os.getenv('DATABASE_NAME', 'test')]

        if phone_number == "7866736662":  # TODO: Remove this hardcoded check
            assistant = db['nia-assistants'].find_one({'subDomain': 'nest'})
        else:
            assistant = db['nia-assistants'].find_one({'assistantPhoneNumber': phone_number})
            
        if assistant:
            return json.loads(json_util.dumps(assistant['model']))
        
        print(f"Assistant not found for phone number: {phone_number}. Bailing.")
        return None
        
    except Exception as error:
        print(f"Error: {error}")
        return None
    
