#!/usr/bin/env python3
"""
Quick test script to verify model selection configuration.
Run this to test the model factory without starting the full bot.

Usage:
    python test_model_selection.py
    
Or test specific model:
    BOT_MODEL_SELECTION=llama-3.3-70b python test_model_selection.py
"""

import os
import sys

# Load .env file
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    print("⚠️  Warning: dotenv not installed, using environment variables only")

def get_llm_config(model_selection: str):
    """Factory function to return LLM configuration based on selection."""
    
    if model_selection == "llama-4-scout":
        groq_api_key = os.getenv("GROQ_API_KEY")
        if not groq_api_key:
            raise ValueError("GROQ_API_KEY is required for llama-4-scout")
        return {
            "api_key": groq_api_key,
            "model": "llama-4-scout",
            "base_url": "https://api.groq.com/openai/v1",
            "provider": "Groq",
        }
            
    elif model_selection == "llama-3.3-70b":
        groq_api_key = os.getenv("GROQ_API_KEY")
        if not groq_api_key:
            raise ValueError("GROQ_API_KEY is required for llama-3.3-70b")
        return {
            "api_key": groq_api_key,
            "model": "llama-3.3-70b-versatile",
            "base_url": "https://api.groq.com/openai/v1",
            "provider": "Groq",
        }
            
    elif model_selection == "hermes-4-70b":
        openrouter_api_key = os.getenv("OPENROUTER_API_KEY")
        if not openrouter_api_key:
            raise ValueError("OPENROUTER_API_KEY is required for hermes-4-70b")
        return {
            "api_key": openrouter_api_key,
            "model": "nousresearch/hermes-4-70b",
            "base_url": "https://openrouter.ai/api/v1",
            "provider": "OpenRouter",
        }
            
    else:  # default to gpt-4o-mini
        openai_api_key = os.getenv("OPENAI_API_KEY")
        if not openai_api_key:
            raise ValueError("OPENAI_API_KEY is required for gpt-4o-mini")
        return {
            "api_key": openai_api_key,
            "model": "gpt-4o-mini",
            "base_url": None,
            "provider": "OpenAI",
        }


def test_model_config():
    """Test the model configuration."""
    
    print("\n" + "="*60)
    print("🧪 Model Selection Configuration Test")
    print("="*60 + "\n")
    
    # Read model selection from environment
    model_selection = os.getenv("BOT_MODEL_SELECTION", "gpt-4o-mini")
    print(f"📋 Selected Model: {model_selection}")
    print()
    
    # Test all models
    test_models = ["gpt-4o-mini", "llama-4-scout", "llama-3.3-70b", "hermes-4-70b"]
    
    for model in test_models:
        is_active = (model == model_selection)
        status_icon = "✅" if is_active else "⚪"
        
        print(f"{status_icon} Testing: {model}")
        
        try:
            config = get_llm_config(model)
            
            # Mask API key (show first 10 chars + ...)
            masked_key = config["api_key"][:10] + "..." if config["api_key"] else "MISSING"
            
            print(f"   Provider: {config['provider']}")
            print(f"   Model: {config['model']}")
            print(f"   Base URL: {config['base_url'] or 'Default'}")
            print(f"   API Key: {masked_key}")
            
            if is_active:
                print(f"   🎯 This is the ACTIVE model!")
            
            print()
            
        except ValueError as e:
            print(f"   ❌ ERROR: {e}")
            print()
    
    print("="*60)
    print("\n✅ Configuration test complete!\n")
    
    # Show how to switch models
    print("To switch models, set BOT_MODEL_SELECTION in .env:")
    print()
    print("  BOT_MODEL_SELECTION=gpt-4o-mini     # OpenAI (default)")
    print("  BOT_MODEL_SELECTION=llama-4-scout   # Groq (fastest)")
    print("  BOT_MODEL_SELECTION=llama-3.3-70b   # Groq (best balance)")
    print("  BOT_MODEL_SELECTION=hermes-4-70b    # OpenRouter (uncensored)")
    print()
    print("Then restart the bot gateway to apply changes.")
    print()


def verify_api_keys():
    """Verify all required API keys are present."""
    
    print("\n" + "="*60)
    print("🔑 API Key Verification")
    print("="*60 + "\n")
    
    keys = {
        "OPENAI_API_KEY": os.getenv("OPENAI_API_KEY"),
        "GROQ_API_KEY": os.getenv("GROQ_API_KEY"),
        "OPENROUTER_API_KEY": os.getenv("OPENROUTER_API_KEY"),
    }
    
    all_present = True
    
    for key_name, key_value in keys.items():
        if key_value:
            masked = key_value[:10] + "..." if len(key_value) > 10 else "***"
            print(f"✅ {key_name}: {masked}")
        else:
            print(f"❌ {key_name}: MISSING")
            all_present = False
    
    print()
    
    if all_present:
        print("✅ All API keys present!")
    else:
        print("⚠️  Some API keys are missing. You'll need them for those models.")
    
    print()


if __name__ == "__main__":
    try:
        verify_api_keys()
        test_model_config()
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Error: {e}\n")
        sys.exit(1)
