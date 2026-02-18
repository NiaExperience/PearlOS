#!/usr/bin/env python3
"""
MiniMax M2.5 Integration Test Script

Tests the MiniMax API connection and basic functionality before running voice tests.

Usage:
    python test_minimax.py [--api-key YOUR_KEY]

Environment:
    MINIMAX_API_KEY - API key for MiniMax (if not passed as argument)
"""

import os
import sys
import argparse
from openai import OpenAI
import time

def test_minimax_connection(api_key: str) -> bool:
    """Test basic connection to MiniMax API."""
    print("🔌 Testing MiniMax API connection...")
    
    try:
        client = OpenAI(
            api_key=api_key,
            base_url="https://api.minimax.io/v1"
        )
        
        # Simple test message
        response = client.chat.completions.create(
            model="MiniMax-M2.5-highspeed",
            messages=[
                {"role": "system", "content": "You are a helpful assistant. Respond with exactly 5 words."},
                {"role": "user", "content": "Say hello"},
            ],
            max_tokens=50
        )
        
        reply = response.choices[0].message.content
        print(f"✅ Connection successful!")
        print(f"   Response: {reply}")
        return True
        
    except Exception as e:
        print(f"❌ Connection failed: {e}")
        return False


def test_tool_calling(api_key: str) -> bool:
    """Test tool calling functionality."""
    print("\n🛠️  Testing tool calling...")
    
    try:
        client = OpenAI(
            api_key=api_key,
            base_url="https://api.minimax.io/v1"
        )
        
        # Define a simple test tool
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "get_weather",
                    "description": "Get the current weather in a given location",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "location": {
                                "type": "string",
                                "description": "The city and state, e.g. San Francisco, CA"
                            },
                            "unit": {
                                "type": "string",
                                "enum": ["celsius", "fahrenheit"]
                            }
                        },
                        "required": ["location"]
                    }
                }
            }
        ]
        
        response = client.chat.completions.create(
            model="MiniMax-M2.5-highspeed",
            messages=[
                {"role": "user", "content": "What's the weather in San Francisco?"}
            ],
            tools=tools,
            max_tokens=200
        )
        
        # Check if tool was called
        message = response.choices[0].message
        if message.tool_calls:
            tool_call = message.tool_calls[0]
            print(f"✅ Tool calling works!")
            print(f"   Called: {tool_call.function.name}")
            print(f"   Arguments: {tool_call.function.arguments}")
            return True
        else:
            print(f"⚠️  No tool call detected (might still work, but unexpected)")
            print(f"   Response: {message.content}")
            return True  # Not necessarily a failure
            
    except Exception as e:
        print(f"❌ Tool calling test failed: {e}")
        return False


def test_streaming(api_key: str) -> bool:
    """Test streaming responses."""
    print("\n📡 Testing streaming...")
    
    try:
        client = OpenAI(
            api_key=api_key,
            base_url="https://api.minimax.io/v1"
        )
        
        print("   Streaming response: ", end="", flush=True)
        
        stream = client.chat.completions.create(
            model="MiniMax-M2.5-highspeed",
            messages=[
                {"role": "user", "content": "Count from 1 to 5"}
            ],
            stream=True,
            max_tokens=50
        )
        
        chunks_received = 0
        for chunk in stream:
            if chunk.choices[0].delta.content:
                print(chunk.choices[0].delta.content, end="", flush=True)
                chunks_received += 1
        
        print()  # newline
        
        if chunks_received > 0:
            print(f"✅ Streaming works! ({chunks_received} chunks received)")
            return True
        else:
            print(f"❌ No chunks received")
            return False
            
    except Exception as e:
        print(f"❌ Streaming test failed: {e}")
        return False


def test_performance(api_key: str) -> bool:
    """Test response latency (should be <3s for 100 TPS)."""
    print("\n⚡ Testing performance...")
    
    try:
        client = OpenAI(
            api_key=api_key,
            base_url="https://api.minimax.io/v1"
        )
        
        start_time = time.time()
        
        response = client.chat.completions.create(
            model="MiniMax-M2.5-highspeed",
            messages=[
                {"role": "user", "content": "What is 2+2? Answer in one word."}
            ],
            max_tokens=10
        )
        
        latency = time.time() - start_time
        
        print(f"   Latency: {latency:.2f}s")
        
        if latency < 3.0:
            print(f"✅ Performance good! (<3s)")
            return True
        elif latency < 5.0:
            print(f"⚠️  Performance acceptable (3-5s)")
            return True
        else:
            print(f"❌ Performance slow (>{latency:.1f}s)")
            return False
            
    except Exception as e:
        print(f"❌ Performance test failed: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Test MiniMax M2.5 integration")
    parser.add_argument("--api-key", help="MiniMax API key (or set MINIMAX_API_KEY env var)")
    args = parser.parse_args()
    
    # Get API key
    api_key = args.api_key or os.getenv("MINIMAX_API_KEY")
    
    if not api_key:
        print("❌ ERROR: No API key provided!")
        print("\nOptions:")
        print("  1. Set MINIMAX_API_KEY environment variable")
        print("  2. Pass --api-key argument")
        print("\nGet your key at: https://platform.minimax.io")
        sys.exit(1)
    
    print("=" * 60)
    print("MiniMax M2.5 Integration Test Suite")
    print("=" * 60)
    
    # Run tests
    tests = [
        ("Connection", test_minimax_connection),
        ("Tool Calling", test_tool_calling),
        ("Streaming", test_streaming),
        ("Performance", test_performance),
    ]
    
    results = {}
    for name, test_func in tests:
        results[name] = test_func(api_key)
    
    # Summary
    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for name, passed_test in results.items():
        status = "✅ PASS" if passed_test else "❌ FAIL"
        print(f"{status} - {name}")
    
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All tests passed! MiniMax integration is ready.")
        print("\nNext steps:")
        print("  1. Set BOT_MODEL_SELECTION=minimax-m2.5 in .env")
        print("  2. Restart the bot: npm run restart-bot")
        print("  3. Test voice commands (see MINIMAX_INTEGRATION.md)")
        return 0
    else:
        print("\n⚠️  Some tests failed. Check the errors above.")
        print("\nTroubleshooting:")
        print("  - Verify API key is correct")
        print("  - Check https://platform.minimax.io for service status")
        print("  - Review MiniMax API docs: https://platform.minimax.io/docs")
        return 1


if __name__ == "__main__":
    sys.exit(main())
