import redis
import json
import time
import sys
import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env.local from workspace root
# Script is in /scripts, so root is parent
env_path = Path(__file__).resolve().parent.parent / ".env.local"
load_dotenv(env_path)

# Configuration
USER_ID = "643fdb08-672d-4272-a138-8c1e8a6b8db3"
ROOM_URL = f"https://pearlos.daily.co/voice-{USER_ID}"

# For local spoofing via port-forward, we force localhost
REDIS_HOST = "localhost"
REDIS_PORT = 6380

# Get password from env
REDIS_AUTH_REQUIRED = os.getenv("REDIS_AUTH_REQUIRED", "false").lower() == "true"
REDIS_PASSWORD = os.getenv("REDIS_SHARED_SECRET") if REDIS_AUTH_REQUIRED else None

KEY = f"room_active:{ROOM_URL}"

# Fake session data mimicking a warm runner session
PAYLOAD = {
    "status": "running",
    "runner_url": "http://fake-runner-url:8080", # Unreachable URL
    "session_id": "fake-zombie-session-123",
    "pid": 9999,
    "type": "warm",
    "personalityId": "fake-personality-id",
    "persona": "Pearl",
    "timestamp": time.time()
}

def main():
    print(f"🔌 Connecting to Redis at {REDIS_HOST}:{REDIS_PORT}...")
    try:
        r = redis.Redis(
            host=REDIS_HOST, 
            port=REDIS_PORT, 
            password=REDIS_PASSWORD,
            decode_responses=True
        )
        r.ping()
    except redis.ConnectionError as e:
        print(f"❌ Could not connect to Redis: {e}")
        print("   Make sure you have port-forwarding active:")
        print("   kubectl port-forward svc/redis 6380:6379")
        sys.exit(1)
    except redis.AuthenticationError:
        print("❌ Authentication failed. Check REDIS_SHARED_SECRET in .env.local")
        sys.exit(1)

    print(f"🧟 Spawning zombie session for room: {ROOM_URL}")
    print(f"🔑 Redis Key: {KEY}")
    
    # Set the key
    r.set(KEY, json.dumps(PAYLOAD))
    
    # Verify it's there
    val = r.get(KEY)
    if val:
        print("✅ Zombie session created successfully!")
        print(f"📄 Payload: {val}")
        print("\n👀 Watch the operator logs to see it get reaped:")
        print("   kubectl logs -l app=pipecat-operator -f")
    else:
        print("❌ Failed to set key.")

if __name__ == "__main__":
    main()
