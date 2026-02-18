from typing import Any, cast

from ncp.services.utils import API_BASE_URL, make_api_get_request


async def fetch_agendas_from_api(
    assistant_name: str, query_params: list[str] | None = None
) -> list[dict[str, Any]]:
    """
    Fetches agenda data from the /api/agendaList endpoint.
    """
    params = {"agent": assistant_name}
    if query_params:
        params["query"] = ",".join(query_params)

    url = f"{API_BASE_URL}/api/agendaList"

    data = await make_api_get_request(url, params)

    if data is None:
        return []  # Return empty list on error, as per original logic

    agendas_value = data.get("agendas")
    if isinstance(agendas_value, list):
        return cast("list[dict[str, Any]]", agendas_value)
    return []


async def fetch_individual_agenda_from_api(
    assistant_name: str, agenda_title: str
) -> dict[str, Any] | None:
    """
    Fetches a single agenda item by its title from the /api/agendaDetail endpoint.
    """
    params = {"agent": assistant_name, "title": agenda_title}
    url = f"{API_BASE_URL}/api/agendaDetail"

    data = await make_api_get_request(url, params)

    # The helper function make_api_get_request now returns None on errors,
    # including HTTPStatusError (like 404).
    # The specific print for 404 from this function is removed as the helper prints.
    return data if data else None
