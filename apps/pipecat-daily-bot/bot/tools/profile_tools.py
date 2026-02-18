"""User Profile Tool Functions.

Tools for managing user profiles (preferences, settings, metadata).
"""

import os

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from actions import profile_actions
from tools.decorators import bot_tool
from tools.logging_utils import bind_tool_logger


# Built-in fallback descriptions
DEFAULT_PROFILE_TOOL_PROMPTS: dict[str, str] = {
    'bot_update_user_profile': (
        "Save or update user profile when learning new information (upsert pattern - works for both new and existing profiles). "
        "TRIGGER PHRASES - When user says: "
        "'I like/love/enjoy X' → save under 'interests'. "
        "'I work at/on X' → save under 'work'. "
        "'My name is X' → save under 'name'. "
        "'I'm from X' → save under 'location'. "
        "'I have X hobby/pet' → save under 'hobbies' or 'pets'. "
        "'I prefer X' → save under 'preferences'. "
        "'I've been doing X lately' → save under 'recent_activities'. "
        "EXAMPLES: "
        "User says 'I love hiking' → save {'interests': 'hiking'}. "
        "User says 'I work at Microsoft' → save {'work': 'Microsoft'}. "
        "User says 'I have two dogs' → save {'pets': 'two dogs'}. "
        "User says 'I prefer coffee over tea' → save {'preferences': 'coffee'}. "
        "Use descriptive keys like 'interests', 'work', 'hobbies', 'family', 'pets', 'goals', 'preferences', 'recent_projects', 'recent_activities'. "
        "Call this IMMEDIATELY after learning something new about the user. "
        "Works for both new profiles and existing ones."
    ),
    'bot_delete_profile_metadata': (
        "Remove specific fields from the user's profile metadata or clear all metadata. "
        "Use when user asks to remove information or when you need to delete outdated/incorrect data. "
        "Can delete specific keys or clear everything."
    ),
}


# ============================================================================
# Profile Tool Handlers (Decorated)
# ============================================================================


@bot_tool(
    name="bot_update_user_profile",
    description=DEFAULT_PROFILE_TOOL_PROMPTS["bot_update_user_profile"],
    feature_flag="userProfile",
    parameters={
        "type": "object",
        "properties": {},
        "additionalProperties": True,
        "description": "Profile fields to save or update (e.g., {\"pets\": \"two dogs\", \"interests\": \"hiking\"})"
    }
)
async def bot_update_user_profile(params: FunctionCallParams):
    """Save or update user profile with preferences and settings (upsert pattern)."""
    arguments = params.arguments
    context = getattr(params, 'handler_context', params.context)
    log = bind_tool_logger(params, tag="[profile_tools]").bind(arguments=arguments)
    
    log.debug("bot_update_user_profile called with arguments")
    
    # Arguments dict IS the updates - no nested "updates" key
    # These updates should go directly into the profile's metadata field
    updates = arguments.get("updates", arguments if arguments else {})
    
    # DON'T wrap in another metadata layer - these ARE the metadata updates
    # The upsert function will handle merging into existing metadata
    wrapped_updates = {"metadata": updates}
    
    log = log.bind(updates=updates)
    log.debug("Profile metadata updates prepared")
    
    try:
        # Get user_id from context (not from LLM arguments)
        user_id = context.user_id() if context and hasattr(context, 'user_id') else None
        if not user_id:
            user_id = os.environ.get('BOT_SESSION_USER_ID')
            if user_id:
                log.bind(userId=user_id).info("Using BOT_SESSION_USER_ID from environment")
        
        if not user_id or not user_id.strip():
            await params.result_callback({
                "success": False,
                "error": "Invalid user_id",
                "user_message": "User ID is required to update profile"
            }, properties=FunctionCallResultProperties(run_llm=False))
            return
        
        # Get email and name from session context (required by UserProfile schema)
        user_email = context.user_email() if context and hasattr(context, 'user_email') else None
        user_name = context.user_name() if context and hasattr(context, 'user_name') else None
        
        # Enrich wrapped_updates with required fields from session
        if user_email:
            wrapped_updates["email"] = user_email
        if user_name:
            wrapped_updates["first_name"] = user_name
        
        log.bind(userEmail=user_email, userName=user_name).debug("Enriched data with session info")
        
        # Save/update user profile via actions layer (upsert pattern)
        # UserProfile operations always use tenant="any"
        profile = await profile_actions.upsert_user_profile(
            user_id=user_id,
            data=wrapped_updates
        )
        
        if profile:
            log.bind(userId=user_id).info("Saved/updated profile")
            await params.result_callback({
                "success": True,
                "profile_id": profile.get("_id"),
                "user_message": "Successfully saved user profile information"
            }, properties=FunctionCallResultProperties(run_llm=False))
            return
        else:
            await params.result_callback({
                "success": False,
                "error": "Profile operation failed",
                "user_message": "Failed to save user profile"
            }, properties=FunctionCallResultProperties(run_llm=False))
            return
            
    except ValueError as e:
        log.error("Validation error saving profile", exc_info=True)
        await params.result_callback({
            "success": False,
            "error": str(e),
            "user_message": f"Cannot save profile: {e}"
        }, properties=FunctionCallResultProperties(run_llm=False))
    except Exception as e:
        log.error("Error saving/updating user profile", exc_info=True)
        await params.result_callback({
            "success": False,
            "error": str(e),
            "user_message": f"Error updating profile: {str(e)}"
        }, properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_delete_profile_metadata",
    description=DEFAULT_PROFILE_TOOL_PROMPTS["bot_delete_profile_metadata"],
    feature_flag="userProfile",
    parameters={
        "user_id": {
            "type": "string",
            "description": "User ID to delete metadata for"
        },
        "keys_to_delete": {
            "type": "array",
            "description": "List of metadata keys to delete. Omit to clear all metadata.",
            "items": {"type": "string"},
            "optional": True
        }
    }
)
async def bot_delete_profile_metadata(params: FunctionCallParams):
    """Delete specific metadata keys or clear all metadata from user profile."""
    arguments = params.arguments
    user_id = arguments.get("user_id", "")
    keys_to_delete = arguments.get("keys_to_delete")
    log = bind_tool_logger(params, tag="[profile_tools]").bind(userId=user_id)
    
    try:
        tenant_id = "any"
        if not user_id:
            await params.result_callback({
                "success": False,
                "error": "Missing required parameters"
            })
            return
        
        # Call profile actions to delete metadata
        if keys_to_delete:
            # Delete specific keys
            success = await profile_actions.delete_profile_metadata_keys(
                user_id=user_id,
                keys=keys_to_delete
            )
            message = f"Deleted {len(keys_to_delete)} metadata keys"
        else:
            # Clear all metadata
            success = await profile_actions.clear_profile_metadata(user_id=user_id)
            message = "Cleared all profile metadata"
        
        if success:
            log.info(message)
            await params.result_callback({
                "success": True,
                "user_message": message
            })
        else:
            await params.result_callback({
                "success": False,
                "error": "Failed to delete metadata"
            })
    except Exception as e:
        log.error("Error deleting metadata", exc_info=True)
        await params.result_callback({
            "success": False,
            "error": str(e)
        })
        
    except Exception as e:
        log.error("Error updating profile", exc_info=True)
        await params.result_callback({
            "success": False,
            "error": str(e),
            "user_message": "Failed to update user profile"
        })
        return
