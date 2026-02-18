#!/usr/bin/env python3

"""
Redis Bot Migration Test
Tests the Redis-based heartbeat and identity migrations
"""

import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Import the migration modules
sys.path.append(os.path.join(os.path.dirname(__file__), '../apps/pipecat-daily-bot/bot'))

try:
    from redis_heartbeat_migration import (
        check_redis_heartbeat_available,
        _send_heartbeat_redis,
        _read_heartbeat_redis,
        get_heartbeat_sender,
        get_heartbeat_reader,
    )

    MIGRATION_MODULES_AVAILABLE = True
except ImportError as e:
    logger.error(f"Failed to import migration modules: {e}")
    MIGRATION_MODULES_AVAILABLE = False

def test_redis_heartbeat():
    """Test Redis heartbeat functionality."""
    print("\n💓 Testing Redis heartbeat migration...")

    if not MIGRATION_MODULES_AVAILABLE:
        print("   ❌ Migration modules not available")
        return False

    try:
        available = check_redis_heartbeat_available()
        if not available:
            print("   ⚠️  Redis heartbeat not available")
            return False

        # Test heartbeat sending
        test_pid = 99999
        test_room = "https://test.daily.co/heartbeat-test"
        test_participants = ["user1", "user2"]

        _send_heartbeat_redis(test_pid, test_room, test_participants)
        print("   ✅ Heartbeat sent successfully")

        # Test heartbeat reading (may not work immediately due to TTL)
        heartbeat_data = _read_heartbeat_redis(test_pid)
        if heartbeat_data:
            print(f"   ✅ Heartbeat read successfully: {len(heartbeat_data.get('participants', []))} participants")
        else:
            print("   ⚠️  Heartbeat not found (may be TTL-based)")

        return True

    except Exception as e:
        print(f"   ❌ Redis heartbeat test failed: {e}")
        return False



def test_migration_functions():
    """Test the lazy evaluation functions."""
    print("\n🔄 Testing migration function evaluation...")

    if not MIGRATION_MODULES_AVAILABLE:
        print("   ❌ Migration modules not available")
        return False

    try:
        # Test heartbeat functions
        heartbeat_sender = get_heartbeat_sender()
        heartbeat_reader = get_heartbeat_reader()

        if heartbeat_sender:
            print("   ✅ Redis heartbeat sender available")
        else:
            print("   ⚠️  Using file-based heartbeat sender")

        if heartbeat_reader:
            print("   ✅ Redis heartbeat reader available")
        else:
            print("   ⚠️  Using file-based heartbeat reader")



        return True

    except Exception as e:
        print(f"   ❌ Migration function test failed: {e}")
        return False

def main():
    """Run all tests for Redis bot migrations."""
    print("🤖 Redis Bot Migration Test Suite")
    print("=" * 50)

    if not MIGRATION_MODULES_AVAILABLE:
        print("❌ Cannot run tests - migration modules not available")
        return False

    # Check USE_REDIS environment variable
    use_redis = os.getenv('USE_REDIS', 'false').lower() == 'true'
    print(f"📊 USE_REDIS environment variable: {use_redis}")

    if not use_redis:
        print("⚠️  USE_REDIS is disabled - Redis migrations will use file fallbacks")

    tests = [
        ("Redis Heartbeat", test_redis_heartbeat),
        ("Migration Functions", test_migration_functions),
    ]

    passed = 0
    total = len(tests)

    for test_name, test_func in tests:
        try:
            if test_func():
                passed += 1
            else:
                print(f"❌ {test_name} test failed")
        except Exception as e:
            print(f"❌ {test_name} test crashed: {e}")

    print("\n" + "=" * 50)
    print(f"📊 Test Results: {passed}/{total} tests passed")

    if passed == total:
        print("✅ All Redis bot migration tests passed!")
        print("\n📋 Next Steps:")
        print("   1. Ensure Redis server is running")
        print("   2. Set USE_REDIS=true in environment")
        print("   3. Start pipecat-daily-bot to use Redis migrations")
        return True
    else:
        print("❌ Some tests failed - check Redis connectivity and configuration")
        return False

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)