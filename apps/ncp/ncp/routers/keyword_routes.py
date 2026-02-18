from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from ncp.services.keyword_service import (
    fetch_iframe_keyword_data_from_api,
    fetch_keyword_details_from_api,
)
from ncp.services.utils import API_BASE_URL

router = APIRouter()


class KeywordLookupRequest(BaseModel):
    assistantName: str
    keyword: str


class IframeKeywordRequest(BaseModel):
    assistantName: str
    keyword: str


@router.post("/keywordMemoryLookup")
async def keyword_memory_lookup(request: KeywordLookupRequest) -> dict[str, Any]:
    """
    Performs a keyword memory lookup using an external API.
    Returns a dictionary containing a system message with the lookup result
    and auxiliary data.
    """
    keyword_data = await fetch_keyword_details_from_api(
        request.assistantName, request.keyword
    )

    metadata = {
        "request_info": {
            "url": f"{API_BASE_URL}/api/keyword-memory-lookup",
            "params": {"agent": request.assistantName, "keyword": request.keyword},
        }
    }

    if (
        keyword_data
        and isinstance(keyword_data.get("result"), dict)
        and keyword_data["result"].get("description")
    ):
        description = keyword_data["result"]["description"]
        system_message_content = (
            f'Here\'s what I found about "{request.keyword}": {description}'
        )
    # Handling specific case from an example where result is None but a message exists
    elif (
        keyword_data
        and keyword_data.get("result") is None
        and keyword_data.get("message")
    ):
        system_message_content = keyword_data["message"]
    else:
        system_message_content = (
            f'I couldn\'t find any information about "{request.keyword}".'
        )
        # If the API might return a specific "not found" message,
        # we could pass it through:
        # if keyword_data and keyword_data.get("message"):
        #    system_message_content = keyword_data["message"]

    return {"system_message": system_message_content, "metadata": metadata}


@router.post("/IframeKeyword")
async def iframe_keyword(request: IframeKeywordRequest) -> dict[str, Any]:
    """
    Fetches iframe keyword data (URL, name, description) from an external API.
    Returns this data directly, intended to be used as the 'result' of a
    function call, along with NCP metadata.
    """
    fetched_data = await fetch_iframe_keyword_data_from_api(
        request.assistantName, request.keyword
    )

    metadata = {
        "request_info": {
            "url": f"{API_BASE_URL}/api/iframeKeyword",
            "params": {"agent": request.assistantName, "keyword": request.keyword},
        }
    }

    if fetched_data:
        name = fetched_data.get("name", "Unknown")
        description = fetched_data.get("description", "No description available")

        system_message_content = f"Showing keyword content: {name} - {description}"

        response_data = {
            "system_message": system_message_content,
            "metadata": metadata,
        }
        return response_data
    else:
        # Return a structure indicating failure or no data, with metadata
        return {
            "error": "Failed to fetch iframe keyword data or no data found.",
            "metadata": metadata,
        }
