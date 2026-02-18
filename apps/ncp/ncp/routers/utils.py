from collections.abc import Awaitable, Callable
from typing import Any, Protocol, TypeAlias, runtime_checkable

from ncp.services.utils import API_BASE_URL

ItemList: TypeAlias = list[dict[str, Any]]
QueryParam: TypeAlias = list[str] | None

SuccessMessageFormatter: TypeAlias = Callable[[ItemList, str], str]
FetchListItemsCallable: TypeAlias = Callable[[str, QueryParam], Awaitable[ItemList]]


@runtime_checkable
class ListRequestable(Protocol):
    assistantName: str
    query: list[str] | None


def format_initial_response_parts(
    items_to_consider: list[dict[str, Any]],
    item_type_name: str,  # e.g., "exhibitor", "speaker"
    api_endpoint_path: str,  # e.g., "/api/exhibitor"
    request_data: ListRequestable,  # Contains assistantName and query
) -> tuple[
    dict[str, Any] | None,  # early_response
    str,  # query_string_for_message
    dict[str, Any],  # metadata
]:
    """
    Handles common initial parts of list-based responses.
    - Constructs metadata.
    - Checks if items_to_consider is empty and returns a "no items found" response.
    - Generates a query_string for messages if a query is provided.
    Returns:
        - A response dictionary if no items are found, else None (for early return).
        - A query_string for message construction.
        - The constructed metadata dictionary.
    """
    params_for_api: dict[str, Any] = {"agent": request_data.assistantName}
    if request_data.query:
        params_for_api["query"] = ",".join(request_data.query)

    metadata: dict[str, Any] = {
        "request_info": {
            "url": f"{API_BASE_URL}{api_endpoint_path}",  # Use global API_BASE_URL
            "params": params_for_api,
        }
    }

    if not items_to_consider:
        system_message = (
            f"No {item_type_name} items found matching your query from the API."
        )
        return (
            {
                "system_message": system_message,
                "metadata": metadata,
            },
            "",  # query_string_for_message (empty for "not found")
            metadata,
        )

    query_string_for_message = ""
    if request_data.query:
        query_string_for_message = f" for query: {', '.join(request_data.query)}"

    return None, query_string_for_message, metadata


async def handle_list_endpoint(
    request: ListRequestable,
    fetch_items_func: FetchListItemsCallable,
    item_type_name: str,
    api_endpoint_path: str,
    format_success_message_func: SuccessMessageFormatter,
) -> dict[str, Any]:
    """
    Handles the common flow for list-based API endpoints.
    - Fetches items using the provided async fetch_items_func.
    - Calls format_initial_response_parts to get initial response components.
    - Handles early exit if no items are found.
    - Formats the success message using a specific formatter function.
    - Returns the final response dictionary.
    """
    items_to_consider = await fetch_items_func(
        request.assistantName,
        request.query,
    )

    (
        early_response,
        query_string_for_message,
        metadata,
    ) = format_initial_response_parts(
        items_to_consider=items_to_consider,
        item_type_name=item_type_name,
        api_endpoint_path=api_endpoint_path,
        request_data=request,
    )

    if early_response:
        return early_response

    final_system_message_content = format_success_message_func(
        items_to_consider, query_string_for_message
    )

    return {"system_message": final_system_message_content, "metadata": metadata}
