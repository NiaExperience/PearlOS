from flask import Flask, jsonify, request
from pymongo import MongoClient
from bson import ObjectId
import json

app = Flask(__name__)


# MongoDB Configuration
#DATABASE_URL = "mongodb+srv://mukul:mukul123@pearl-cluster.fmrazto.mongodb.net/?retryWrites=true&w=majority&appName=pearl-cluster"
DATABASE_URL = "mongodb+srv://stagetester:ceWma8-xorjeq-wawfar@nia-staging.kooc1.mongodb.net/"
DATABASE_NAME = "nia-staging"
COLLECTION_NAME = "nia-users"

# User ID (Replace this with the correct ID)
user_id = "67b60db0fa7e96b2e1f6b527"

@app.route('/vapi', methods=['POST'])
def vapi():
    if request.method == 'POST':
        data = request.json  
        print("VAPI endpoint hit")
        if data["message"]["type"] == "end-of-call-report":        
            print("Got end-of-call")
            
            # Extract relevant messages
            messages = data["message"]["artifact"]["messages"]
            filtered_messages = [
                {
                    "role": msg["role"],
                    "message": msg["message"],
                    "timestamp": msg["time"],
                    "duration": msg.get("duration", None)
                }
                for msg in messages if msg["role"] in ["bot", "user"]
            ]
            conversation_entry = {
                "timestamp": data["message"]["timestamp"],
                "analysis": data["message"]["analysis"],
                "messages": filtered_messages
            }
            print("Filtered: ", filtered_messages)
            try:
                client = MongoClient(DATABASE_URL)
                db = client[DATABASE_NAME]
                collection = db[COLLECTION_NAME]

                query = {"_id": ObjectId(user_id)}

                user_doc = collection.find_one(query)
                print("USER: ", user_doc)  # If None, the document doesn't exist

                result = collection.update_one(
                   {"_id": ObjectId(user_id)},
                   {"$push": {"chat_history": conversation_entry}} 
                )

                if result.matched_count > 0:
                    print(f"Updated document for user {user_id} with {len(filtered_messages)} new messages.")
                else:
                    print("No matching document found.")
            except Exception as e:
                print(f"Error: {e}")
            finally:
                client.close()
        return jsonify({"message": "POST received", "data": data}), 200
    return jsonify({"message": "GET request received"}), 200


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=80, debug=True)


