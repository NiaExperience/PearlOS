"""Helper functions for registering content definitions with Mesh API."""
import requests
from typing import Dict, List, Any, Optional


def register_content_definition(
    definition: Dict[str, Any],
    mesh_url: str,
    tenant: str,
    mesh_secret: Optional[str] = None,
) -> bool:
    """Register a single content definition with Mesh.
    
    Args:
        definition: Content definition dictionary
        mesh_url: Base URL for Mesh API (e.g., http://localhost:5002/api - includes /api)
        tenant: Tenant ID
        mesh_secret: Optional mesh shared secret for authentication
        
    Returns:
        True if registration succeeded, False otherwise
    """
    try:
        # Check if definition already exists
        headers = {"Accept": "application/json"}
        if mesh_secret:
            headers["x-mesh-secret"] = mesh_secret
            
        type_name = definition.get("name")
        if not type_name:
            print(f"❌ Definition missing 'name' field")
            return False
            
        # GET to check if exists
        get_url = f"{mesh_url}/definition/{type_name}"
        get_response = requests.get(
            get_url,
            params={"tenant": tenant},
            headers=headers,
            timeout=10
        )
        
        # If it exists (200), we're done
        if get_response.status_code == 200:
            return True
            
        # If it doesn't exist (404), create it
        if get_response.status_code == 404:
            post_url = f"{mesh_url}/definition"
            post_response = requests.post(
                post_url,
                params={"tenant": tenant},
                headers=headers,
                json={"definition": definition},
                timeout=10
            )
            
            if post_response.status_code in (200, 201):
                return True
            else:
                print(f"❌ Failed to register {type_name}: {post_response.status_code} {post_response.reason} for url: {post_url}?tenant={tenant}")
                return False
        else:
            print(f"❌ Unexpected status {get_response.status_code} checking for {type_name}")
            return False
            
    except Exception as e:
        print(f"❌ Exception registering definition: {e}")
        return False


def ensure_content_definitions(
    definitions: List[Dict[str, Any]],
    mesh_url: str,
    tenant: str,
    mesh_secret: Optional[str] = None,
) -> Dict[str, bool]:
    """Ensure multiple content definitions are registered with Mesh.
    
    Args:
        definitions: List of content definition dictionaries
        mesh_url: Base URL for Mesh API (e.g., http://localhost:5002/api - includes /api)
        tenant: Tenant ID
        mesh_secret: Optional mesh shared secret for authentication
        
    Returns:
        Dictionary mapping definition names to success status
    """
    results = {}
    for definition in definitions:
        name = definition.get("name", "unknown")
        success = register_content_definition(
            definition=definition,
            mesh_url=mesh_url,
            tenant=tenant,
            mesh_secret=mesh_secret
        )
        results[name] = success
    return results


def register_all_definitions(
    mesh_url: str,
    tenant: str,
    mesh_secret: Optional[str] = None,
) -> Dict[str, bool]:
    """Register all definitions from this package with Mesh.
    
    Args:
        mesh_url: Base URL for Mesh API (e.g., http://localhost:5002/api - includes /api)
        tenant: Tenant ID
        mesh_secret: Optional mesh shared secret for authentication
        
    Returns:
        Dictionary mapping definition names to success status
    """
    from .definitions import ALL_DEFINITIONS
    
    return ensure_content_definitions(
        definitions=ALL_DEFINITIONS,
        mesh_url=mesh_url,
        tenant=tenant,
        mesh_secret=mesh_secret
    )
