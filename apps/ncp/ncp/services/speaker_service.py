from typing import Any, cast

from ncp.services.utils import API_BASE_URL, make_api_get_request


async def fetch_speakers_from_api(
    assistant_name: str, query_params: list[str] | None = None
) -> list[dict[str, Any]]:
    """
    Fetches speaker data from the /api/speakerList endpoint.
    """
    params = {"agent": assistant_name}
    if query_params:
        params["query"] = ",".join(query_params)

    url = f"{API_BASE_URL}/api/speakerList"

    data = await make_api_get_request(url, params)

    if data is None:
        return []  # Return empty list on error, as per original logic

    speakers_value = data.get("speakers")
    if isinstance(speakers_value, list):
        return cast("list[dict[str, Any]]", speakers_value)
    return []


async def fetch_individual_speaker_from_api(
    assistant_name: str, speaker_name: str
) -> dict[str, Any] | None:
    """
    Fetches a single speaker by their name from the /api/speakerDetail endpoint.
    """
    params = {"agent": assistant_name, "name": speaker_name}
    url = f"{API_BASE_URL}/api/speakerDetail"

    data = await make_api_get_request(url, params)

    # The helper function make_api_get_request returns None on errors.
    return data if data else None
