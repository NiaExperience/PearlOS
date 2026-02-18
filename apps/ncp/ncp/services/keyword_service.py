from typing import Any

from ncp.services.utils import API_BASE_URL, make_api_get_request


async def fetch_keyword_details_from_api(
    assistant_name: str, keyword: str
) -> dict[str, Any] | None:
    """
    Fetches keyword details from the /api/keyword-memory-lookup endpoint.
    """
    params = {"agent": assistant_name, "keyword": keyword}
    url = f"{API_BASE_URL}/api/keyword-memory-lookup"

    data = await make_api_get_request(url, params)

    return data if data else None


async def fetch_iframe_keyword_data_from_api(
    assistant_name: str, keyword: str
) -> dict[str, Any] | None:
    """
    Fetches iframe keyword data from the /api/iframeKeyword endpoint.
    """
    params = {"agent": assistant_name, "keyword": keyword}
    # Note: This URL assumes the /api/iframeKeyword is served by the same
    # Next.js application defined by API_BASE_URL.
    url = f"{API_BASE_URL}/api/iframeKeyword"

    data = await make_api_get_request(url, params)

    return data if data else None
