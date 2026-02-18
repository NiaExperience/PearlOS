from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from ncp.routers.utils import handle_list_endpoint
from ncp.services.exhibitor_service import (
    fetch_exhibitors_from_api,
    fetch_individual_exhibitor_from_api,
)
from ncp.services.utils import API_BASE_URL  # Changed import

router = APIRouter()


class ShowExhibitorsRequest(BaseModel):
    assistantName: str
    query: list[str] | None = None


class ShowIndividualExhibitorRequest(BaseModel):
    assistantName: str
    exhibitorTitle: str


def _format_exhibitor_success_message(
    exhibitors: list[dict[str, Any]], query_string: str
) -> str:
    if len(exhibitors) < 5:
        system_message_content = (
            f"Here are the details of all exhibitors{query_string}:\n\n"
        )
        exhibitor_details_list = []
        for exhibitor_item in exhibitors:
            title = exhibitor_item.get("title", "N/A")
            location = exhibitor_item.get("location", "N/A")
            category = exhibitor_item.get("category", "N/A")
            exhibitor_details_list.append(
                f"- Title: {title}\n  Location: {location}\n  Category: {category}"
            )
        system_message_content += "\n\n".join(exhibitor_details_list)
    else:
        system_message_content = (
            f"Here are the list of titles of all exhibitors{query_string}: "
            f"they are total {len(exhibitors)} exhibitors\n\n"
        )
        exhibitor_titles_list = [
            exhibitor.get("title", "N/A") for exhibitor in exhibitors
        ]
        system_message_content += "\n".join(exhibitor_titles_list)
    return system_message_content


@router.post("/showExhibitors")
async def showExhibitors(request: ShowExhibitorsRequest) -> dict[str, Any]:
    """
    Fetches exhibitor items from an API. If a query (list of categories/tags)
    is provided, it filters items by those categories via the API.
    Returns a dictionary containing a system message with matching exhibitor items
    and auxiliary data.
    """
    return await handle_list_endpoint(
        request=request,
        fetch_items_func=fetch_exhibitors_from_api,
        item_type_name="exhibitor",
        api_endpoint_path="/api/exhibitor",
        format_success_message_func=_format_exhibitor_success_message,
    )


@router.post("/showIndividualExhibitor")
async def showIndividualExhibitor(
    request: ShowIndividualExhibitorRequest,
) -> dict[str, Any]:
    """
    Fetches a specific exhibitor by its title from an API.
    Returns a dictionary containing a system message with the exhibitor's details
    and auxiliary data.
    """
    exhibitor_item = await fetch_individual_exhibitor_from_api(
        request.assistantName, request.exhibitorTitle
    )

    metadata = {
        "request_info": {
            "url": f"{API_BASE_URL}/api/exhibitorDetail",
            "params": {"agent": request.assistantName, "title": request.exhibitorTitle},
        }
    }

    if not exhibitor_item:
        system_message = (
            f"No exhibitor found with the title '{request.exhibitorTitle}'."
        )
        return {
            "system_message": system_message,
            "metadata": metadata,
        }

    title = exhibitor_item.get("title", "N/A")
    location = exhibitor_item.get("location", "N/A")
    category = exhibitor_item.get("category", "N/A")
    description = exhibitor_item.get("description", "N/A")
    ex_tags_list = exhibitor_item.get("exTags", [])
    ex_tags = ", ".join(ex_tags_list) if ex_tags_list else "N/A"
    # tell_me_more = exhibitor_item.get("tellMeMore", "N/A") # Optional

    system_message_content = (
        f"Here are the details for the exhibitor '{title}':\n"
        f"- Title: {title}\n"
        f"- Location: {location}\n"
        f"- Category: {category}\n"
        f"- Description: {description}\n"
        f"- Tags: {ex_tags}"
    )
    # if tell_me_more and tell_me_more != "N/A":
    #     system_message_content += f"\n- More Info: {tell_me_more}"

    return {"system_message": system_message_content, "metadata": metadata}
