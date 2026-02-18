"""Business logic layer for bot operations.

Actions perform domain-specific operations by calling mesh_client
for database access. They handle validation, transformation, and
business rules, but do NOT emit events or know about LLM integration.

This layer is:
- Testable independently of LLM/tools
- Reusable by other services
- Focused on business logic only
- Free of framework dependencies (Pipecat, etc.)
"""

# Import all action modules for convenient access
from .notes_actions import *
from .html_actions import *
from .profile_actions import *
from .personality_actions import *
from .functional_prompt_actions import *
from .search_actions import *

__all__ = [
    # Notes actions (✅ FULLY IMPLEMENTED via mesh_client.request())
    'list_notes',
    'fuzzy_search_notes',
    'get_note_by_id',
    'create_note',
    'update_note_content',
    'append_to_note',
    'update_note_title',
    'delete_note',
    
    # HTML actions (✅ FULLY IMPLEMENTED via mesh_client.request())
    'list_html_generations',
    'fuzzy_search_applets',
    'get_html_generation_by_id',
    'create_html_generation',
    'update_html_generation',
    
    # Profile actions (✅ FULLY IMPLEMENTED via mesh_client.request())
    'get_user_profile',
    'get_user_profile_by_email',
    'create_user_profile',
    'update_user_profile',

    # Personality actions
    'list_personalities',
    'get_personality_by_name',
    'get_personality_by_id',

    # Functional prompt actions
    'fetch_functional_prompt',
    'fetch_functional_prompts',
    
    # Search actions (✅ FULLY IMPLEMENTED - uses aiohttp directly)
    'search_wikipedia',
]
