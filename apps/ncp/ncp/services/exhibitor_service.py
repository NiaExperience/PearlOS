from typing import Any, cast

from ncp.services.utils import API_BASE_URL, make_api_get_request


async def fetch_exhibitors_from_api(
    assistant_name: str, query_params: list[str] | None = None
) -> list[dict[str, Any]]:
    """
    Fetches exhibitor data from the /api/exhibitor endpoint.
    """
    params = {"agent": assistant_name}
    if query_params:
        params["query"] = ",".join(query_params)

    url = f"{API_BASE_URL}/api/exhibitor"

    data = await make_api_get_request(url, params)

    if data is None:
        return []

    exhibitors_value = data.get("exhibitors")
    if isinstance(exhibitors_value, list):
        return cast("list[dict[str, Any]]", exhibitors_value)
    return []


async def fetch_individual_exhibitor_from_api(
    assistant_name: str, exhibitor_title: str
) -> dict[str, Any] | None:
    """
    Fetches a single exhibitor by their title from the /api/exhibitorDetail endpoint.
    """
    params = {"agent": assistant_name, "title": exhibitor_title}
    url = f"{API_BASE_URL}/api/exhibitorDetail"

    data = await make_api_get_request(url, params)

    return data if data else None
