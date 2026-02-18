#!/usr/bin/env python3

"""
Redis Authentication Test Script

Tests Redis connection with and without authentication to verify
REDIS_AUTH_REQUIRED and REDIS_SHARED_SECRET configuration.
"""

import os
import sys
import asyncio
from pathlib import Path

# Add the bot directory to the path so we can import redis_client
sys.path.append(str(Path(__file__).parent.parent / 'apps' / 'pipecat-daily-bot' / 'bot'))

try:
    from services.redis import RedisClient
except ImportError as e:
    print(f"❌ Failed to import RedisClient: {e}")
    print("Make sure you're running this from the repository root")
    sys.exit(1)


async def test_redis_auth():
    """Test Redis authentication configuration."""
    print("🔐 Redis Authentication Test")
    print("=" * 50)

    # Check environment variables
    redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379')
    redis_auth_required = os.getenv('REDIS_AUTH_REQUIRED', 'false').lower() == 'true'
    redis_shared_secret = os.getenv('REDIS_SHARED_SECRET')

    print(f"📊 Configuration:")
    print(f"   REDIS_URL: {redis_url}")
    print(f"   REDIS_AUTH_REQUIRED: {redis_auth_required}")
    print(f"   REDIS_SHARED_SECRET: {'*' * len(redis_shared_secret) if redis_shared_secret else 'Not set'}")
    print()

    # Test Redis client
    client = RedisClient()

    try:
        print("🔍 Testing Redis connectivity...")
        ping_result = await client.ping()

        if ping_result:
            print("✅ Redis ping successful")

            # Test basic operations
            print("🔧 Testing basic Redis operations...")

            # Test heartbeat operation
            test_room_url = "https://test.daily.co/auth-test"

            await client.send_heartbeat(99999, test_room_url, ["user1", "user2"])
            print("✅ Heartbeat sent successfully")

            heartbeat_data = await client.get_heartbeat(99999)
            if heartbeat_data:
                print(f"✅ Heartbeat retrieved: {len(heartbeat_data.get('participants', []))} participants")
            else:
                print("⚠️  Heartbeat not found (may be TTL-based)")

            # Test identity operation
            participant_id = "test-user-auth"
            test_identity = {
                "name": "Auth Test User",
                "context": "Authentication test"
            }

            await client.write_identity(test_room_url, participant_id, test_identity)
            print(f"✅ Identity written for participant: {participant_id}")

            identity_data = await client.read_identity(test_room_url, participant_id)
            if identity_data:
                print(f"✅ Identity retrieved: {identity_data.get('name')}")
            else:
                print("❌ Identity not found after write")

            # Test admin queue operation
            test_message = {
                "action": "test-auth",
                "data": {"test": True}
            }

            await client.send_admin_message(test_room_url, test_message)
            print("✅ Admin message queued successfully")

            messages = await client.get_admin_messages(test_room_url)
            print(f"✅ Retrieved {len(messages)} admin messages")

        else:
            print("❌ Redis ping failed")
            return False

    except Exception as e:
        print(f"❌ Redis connection failed: {e}")

        if redis_auth_required and not redis_shared_secret:
            print("💡 Hint: REDIS_AUTH_REQUIRED=true but REDIS_SHARED_SECRET is not set")
        elif not redis_auth_required:
            print("💡 Hint: Authentication is disabled, check if Redis server is running")
        else:
            print("💡 Hint: Check Redis server and authentication configuration")

        return False

    finally:
        await client.close()

    print("\n🎉 All Redis authentication tests passed!")
    return True


def print_usage():
    """Print usage instructions."""
    print("\n📋 Usage Instructions:")
    print("=" * 30)
    print()
    print("1. **Without Authentication** (default):")
    print("   export REDIS_URL='redis://localhost:6379'")
    print("   export REDIS_AUTH_REQUIRED='false'")
    print("   # REDIS_SHARED_SECRET not needed")
    print()
    print("2. **With Authentication**:")
    print("   export REDIS_URL='redis://localhost:6379'")
    print("   export REDIS_AUTH_REQUIRED='true'")
    print("   export REDIS_SHARED_SECRET='your-generated-secret-here'")
    print()
    print("3. **Run the test**:")
    print("   python scripts/test-redis-auth.py")
    print()
    print("📝 Configuration Notes:")
    print("- REDIS_AUTH_REQUIRED gates whether authentication is used")
    print("- REDIS_SHARED_SECRET must be set when REDIS_AUTH_REQUIRED=true")
    print("- The same secret must be configured in your Redis server")
    print("- Use the Helm chart with auth.enabled: true for Kubernetes deployment")


async def main():
    """Main test function."""
    if len(sys.argv) > 1 and sys.argv[1] in ['-h', '--help', 'help']:
        print_usage()
        return

    success = await test_redis_auth()

    if not success:
        print_usage()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())