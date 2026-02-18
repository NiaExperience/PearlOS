from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from httpx import Request, Response

from ncp import app
from ncp.services.keyword_service import (
    fetch_iframe_keyword_data_from_api,
    fetch_keyword_details_from_api,
)
from ncp.services.utils import API_BASE_URL

client = TestClient(app)


# --- Tests for keyword_service.py ---
@pytest.mark.asyncio
async def test_fetch_keyword_details_from_api_success() -> None:
    assistant_name = "test_assistant"
    keyword = "test_keyword"
    expected_response_data = {"result": {"description": "This is a test keyword."}}
    mock_response = Response(
        200,
        json=expected_response_data,
        request=Request("GET", f"{API_BASE_URL}/api/keyword-memory-lookup"),
    )

    with patch(
        "ncp.services.utils.httpx.AsyncClient.get",
        AsyncMock(return_value=mock_response),
    ) as mock_get:
        response_data = await fetch_keyword_details_from_api(assistant_name, keyword)
        mock_get.assert_called_once_with(
            f"{API_BASE_URL}/api/keyword-memory-lookup",
            params={"agent": assistant_name, "keyword": keyword},
        )
        assert response_data == expected_response_data


@pytest.mark.asyncio
async def test_fetch_keyword_details_from_api_not_found() -> None:
    assistant_name = "test_assistant"
    keyword = "unknown_keyword"
    # Simulate API returning None or an empty dict, or a specific "not found" structure
    mock_response = Response(
        200,  # Or 404, depending on how your actual API behaves for not found
        json={"result": None, "message": "Keyword not found."},  # Example structure
        request=Request("GET", f"{API_BASE_URL}/api/keyword-memory-lookup"),
    )
    with patch(
        "ncp.services.utils.httpx.AsyncClient.get",
        AsyncMock(return_value=mock_response),
    ):
        response_data = await fetch_keyword_details_from_api(assistant_name, keyword)
        assert response_data == {"result": None, "message": "Keyword not found."}


# --- Tests for keyword_routes.py ---
@patch(
    "ncp.routers.keyword_routes.fetch_keyword_details_from_api",
    new_callable=AsyncMock,
)
def test_keyword_memory_lookup_success(mock_fetch_keyword_details: AsyncMock) -> None:
    assistant_name = "route_assistant"
    keyword = "test_keyword"
    mock_data = {"result": {"description": "Successfully found keyword."}}
    mock_fetch_keyword_details.return_value = mock_data

    response = client.post(
        "/keywordMemoryLookup",
        json={"assistantName": assistant_name, "keyword": keyword},
    )
    assert response.status_code == 200
    data = response.json()
    expected_message = (
        f'Here\'s what I found about "{keyword}": {mock_data["result"]["description"]}'
    )
    assert data["system_message"] == expected_message
    assert data["metadata"]["request_info"]["params"]["agent"] == assistant_name
    assert data["metadata"]["request_info"]["params"]["keyword"] == keyword
    mock_fetch_keyword_details.assert_called_once_with(assistant_name, keyword)


@patch(
    "ncp.routers.keyword_routes.fetch_keyword_details_from_api",
    new_callable=AsyncMock,
)
def test_keyword_memory_lookup_not_found(mock_fetch_keyword_details: AsyncMock) -> None:
    assistant_name = "route_assistant"
    keyword = "missing_keyword"
    mock_fetch_keyword_details.return_value = {
        "result": None
    }  # Simulate no description

    response = client.post(
        "/keywordMemoryLookup",
        json={"assistantName": assistant_name, "keyword": keyword},
    )
    assert response.status_code == 200
    data = response.json()
    expected_message = f'I couldn\'t find any information about "{keyword}".'
    assert data["system_message"] == expected_message
    mock_fetch_keyword_details.assert_called_once_with(assistant_name, keyword)


@patch(
    "ncp.routers.keyword_routes.fetch_keyword_details_from_api",
    new_callable=AsyncMock,
)
def test_keyword_memory_lookup_api_returns_message(
    mock_fetch_keyword_details: AsyncMock,
) -> None:
    assistant_name = "route_assistant"
    keyword = "specific_case_keyword"
    # Simulate API returning a message field when result is null
    mock_data = {"result": None, "message": "This keyword is special and not found."}
    mock_fetch_keyword_details.return_value = mock_data

    response = client.post(
        "/keywordMemoryLookup",
        json={"assistantName": assistant_name, "keyword": keyword},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["system_message"] == "This keyword is special and not found."
    mock_fetch_keyword_details.assert_called_once_with(assistant_name, keyword)


# --- Tests for fetch_iframe_keyword_data_from_api in keyword_service.py ---
@pytest.mark.asyncio
async def test_fetch_iframe_keyword_data_from_api_success() -> None:
    assistant_name = "test_assistant_iframe"
    keyword = "iframe_test_keyword"
    expected_api_response = {
        "url": "https://example.com/iframe",
        "name": "Test Iframe",
        "description": "This is a test iframe content.",
    }
    mock_response = Response(
        200,
        json=expected_api_response,
        request=Request("GET", f"{API_BASE_URL}/api/iframeKeyword"),
    )

    with patch(
        "ncp.services.utils.httpx.AsyncClient.get",
        AsyncMock(return_value=mock_response),
    ) as mock_get:
        response_data = await fetch_iframe_keyword_data_from_api(
            assistant_name, keyword
        )
        mock_get.assert_called_once_with(
            f"{API_BASE_URL}/api/iframeKeyword",
            params={"agent": assistant_name, "keyword": keyword},
        )
        assert response_data == expected_api_response


@pytest.mark.asyncio
async def test_fetch_iframe_keyword_data_from_api_not_found() -> None:
    assistant_name = "test_assistant_iframe"
    keyword = "unknown_iframe_keyword"
    # Simulate API returning an error or empty response
    mock_response = Response(
        404, request=Request("GET", f"{API_BASE_URL}/api/iframeKeyword")
    )
    with patch(
        "ncp.services.utils.httpx.AsyncClient.get",
        AsyncMock(return_value=mock_response),
    ) as mock_get:
        response_data = await fetch_iframe_keyword_data_from_api(
            assistant_name, keyword
        )
        mock_get.assert_called_once_with(
            f"{API_BASE_URL}/api/iframeKeyword",
            params={"agent": assistant_name, "keyword": keyword},
        )
        # make_api_get_request returns None on HTTPStatusError
        assert response_data is None


# --- Tests for /IframeKeyword endpoint ---
@patch(
    "ncp.routers.keyword_routes.fetch_iframe_keyword_data_from_api",
    new_callable=AsyncMock,
)
def test_iframe_keyword_route_success(
    mock_fetch_iframe_data: AsyncMock,
) -> None:
    assistant_name = "route_assistant_iframe"
    keyword = "test_iframe_keyword_route"
    mock_api_data = {
        "url": "https://example.com/route",
        "name": "Route Test",
        "description": "Description for route test.",
    }
    mock_fetch_iframe_data.return_value = mock_api_data

    response = client.post(
        "/IframeKeyword",
        json={"assistantName": assistant_name, "keyword": keyword},
    )
    assert response.status_code == 200
    data = response.json()

    name = mock_api_data["name"]
    description = mock_api_data["description"]
    expected_system_message = f"Showing keyword content: {name} - {description}"
    assert data["system_message"] == expected_system_message

    assert data["metadata"]["request_info"]["params"]["agent"] == assistant_name
    assert data["metadata"]["request_info"]["params"]["keyword"] == keyword
    mock_fetch_iframe_data.assert_called_once_with(assistant_name, keyword)


@patch(
    "ncp.routers.keyword_routes.fetch_iframe_keyword_data_from_api",
    new_callable=AsyncMock,
)
def test_iframe_keyword_route_data_not_found(
    mock_fetch_iframe_data: AsyncMock,
) -> None:
    assistant_name = "route_assistant_iframe_nf"
    keyword = "missing_iframe_keyword_route"
    mock_fetch_iframe_data.return_value = None  # Simulate service returning None

    response = client.post(
        "/IframeKeyword",
        json={"assistantName": assistant_name, "keyword": keyword},
    )
    assert response.status_code == 200
    data = response.json()
    assert "error" in data
    assert data["error"] == "Failed to fetch iframe keyword data or no data found."
    assert data["metadata"]["request_info"]["params"]["agent"] == assistant_name
    assert data["metadata"]["request_info"]["params"]["keyword"] == keyword
    mock_fetch_iframe_data.assert_called_once_with(assistant_name, keyword)
