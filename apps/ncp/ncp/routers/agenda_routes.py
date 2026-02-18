from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from ncp.routers.utils import handle_list_endpoint
from ncp.services.agenda_service import (
    fetch_agendas_from_api,
    fetch_individual_agenda_from_api,
)
from ncp.services.utils import API_BASE_URL  # Changed import

router = APIRouter()


class ShowAgendaRequest(BaseModel):
    assistantName: str
    query: list[str] | None = None


class ShowIndividualAgendaRequest(BaseModel):
    assistantName: str
    agendaTitle: str


def _format_agenda_success_message(
    agendas: list[dict[str, Any]], query_string: str
) -> str:
    context_entries = []
    for i, agenda_item in enumerate(agendas):
        title = agenda_item.get("title", "N/A")
        context_entries.append(f"{i + 1}. {title}")

    message_intro = "Here are the agenda item titles from the API"
    # query_string comes from format_initial_response_parts,
    # e.g., " for query: cat1, cat2" or empty if no query.
    system_message_content = f"{message_intro}{query_string}:\n\n" + "\n".join(
        context_entries
    )
    return system_message_content


@router.post("/showAgenda")
async def showAgenda(request: ShowAgendaRequest) -> dict[str, Any]:
    """
    Fetches agenda items from an API. If a query (list of categories) is provided,
    it filters items by those categories via the API.
    Returns a dictionary containing a system message with matching agenda items
    and auxiliary data.
    """
    return await handle_list_endpoint(
        request=request,
        fetch_items_func=fetch_agendas_from_api,
        item_type_name="agenda",
        api_endpoint_path="/api/agendaList",
        format_success_message_func=_format_agenda_success_message,
    )


@router.post("/showIndividualAgenda")
async def showIndividualAgenda(request: ShowIndividualAgendaRequest) -> dict[str, Any]:
    """
    Fetches a specific agenda item by its title from an API.
    Returns a dictionary containing a system message with the agenda item's details
    and auxiliary data.
    """
    agenda_item = await fetch_individual_agenda_from_api(
        request.assistantName, request.agendaTitle
    )

    metadata = {
        "request_info": {
            "url": f"{API_BASE_URL}/api/agendaDetail",
            "params": {"agent": request.assistantName, "title": request.agendaTitle},
        }
    }

    if not agenda_item:
        system_message = f"No agenda item found with the title '{request.agendaTitle}'."
        return {
            "system_message": system_message,
            "metadata": metadata,
        }

    # Extract details for the system message, similar to IndividualAgendaView
    title = agenda_item.get("title", "N/A")
    track = agenda_item.get("track", "N/A")
    day_time = agenda_item.get("dayTime", "N/A")
    location = agenda_item.get("location", "N/A")
    item_type = agenda_item.get("type", "N/A")
    # description = agenda_item.get("description", "N/A") # Optional: include if needed

    system_message_content = (
        f"Here are the details for the agenda item '{title}':\n"
        f"- Title: {title}\n"
        f"- Track: {track}\n"
        f"- Time: {day_time}\n"
        f"- Location: {location}\n"
        f"- Type: {item_type}"
    )

    return {"system_message": system_message_content, "metadata": metadata}
