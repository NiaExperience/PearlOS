from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from ncp.routers.utils import handle_list_endpoint
from ncp.services.speaker_service import (
    fetch_individual_speaker_from_api,
    fetch_speakers_from_api,
)
from ncp.services.utils import API_BASE_URL  # Changed import

router = APIRouter()


class ShowSpeakersRequest(BaseModel):
    assistantName: str
    query: list[str] | None = None


class ShowIndividualSpeakerRequest(BaseModel):
    assistantName: str
    speakerName: str


def _format_speaker_success_message(
    speakers: list[dict[str, Any]], query_string: str
) -> str:
    if len(speakers) < 5:
        system_message_content = (
            f"Here are the details of all speakers{query_string}:\n\n"
        )
        speaker_details_list = []
        for speaker_item in speakers:
            name = speaker_item.get("name", "N/A")
            title = speaker_item.get("title", "N/A")
            company = speaker_item.get("company", "N/A")
            speaker_details_list.append(
                f"- Name: {name}\n  Title: {title}\n  Company: {company}"
            )
        system_message_content += "\n".join(speaker_details_list)
    else:
        system_message_content = (
            f"Here are the list of names of all speakers{query_string}: "
            f"they are total {len(speakers)} speakers\n\n"
        )
        speaker_names_list = [speaker.get("name", "N/A") for speaker in speakers]
        system_message_content += "\n\n".join(speaker_names_list)
    return system_message_content


@router.post("/showSpeakers")
async def showSpeakers(request: ShowSpeakersRequest) -> dict[str, Any]:
    """
    Fetches speaker items from an API. If a query (list of topics) is provided,
    it filters items by those via the API.
    Returns a dictionary containing a system message with matching speaker items
    and auxiliary data.
    """
    return await handle_list_endpoint(
        request=request,
        fetch_items_func=fetch_speakers_from_api,
        item_type_name="speaker",
        api_endpoint_path="/api/speakerList",
        format_success_message_func=_format_speaker_success_message,
    )


@router.post("/showIndividualSpeaker")
async def showIndividualSpeaker(
    request: ShowIndividualSpeakerRequest,
) -> dict[str, Any]:
    """
    Fetches a specific speaker by their name from an API.
    Returns a dictionary containing a system message with the speaker's details
    and auxiliary data.
    """
    speaker_item = await fetch_individual_speaker_from_api(
        request.assistantName, request.speakerName
    )

    metadata = {
        "request_info": {
            "url": f"{API_BASE_URL}/api/speakerDetail",
            "params": {"agent": request.assistantName, "name": request.speakerName},
        }
    }

    if not speaker_item:
        system_message = f"No speaker found with the name '{request.speakerName}'."
        return {
            "system_message": system_message,
            "metadata": metadata,
        }

    name = speaker_item.get("name", "N/A")
    title = speaker_item.get("title", "N/A")
    company = speaker_item.get("company", "N/A")
    session = speaker_item.get("session", "N/A")
    day_time = speaker_item.get("dayTime", "N/A")
    bio = speaker_item.get("bio", "N/A")
    # tell_me_more = speaker_item.get("tellMeMore", "N/A") # Optional

    system_message_content = (
        f"Here are the details for the speaker '{name}':\n"
        f"- Name: {name}\n"
        f"- Title: {title}\n"
        f"- Company: {company}\n"
        f"- Session: {session}\n"
        f"- Schedule: {day_time}\n"
        f"- Bio: {bio}"
    )
    # if tell_me_more and tell_me_more != "N/A":
    #     system_message_content += f"\n- More Info: {tell_me_more}"

    return {"system_message": system_message_content, "metadata": metadata}
