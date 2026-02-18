from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from httpx import HTTPStatusError, Request, RequestError, Response

from ncp import app
from ncp.services.exhibitor_service import (
    fetch_exhibitors_from_api,
    fetch_individual_exhibitor_from_api,
)
from ncp.services.utils import API_BASE_URL

client = TestClient(app)

# --- Tests for exhibitor_service.py ---


@pytest.mark.asyncio
async def test_fetch_exhibitors_from_api_success() -> None:
    """Test successful fetching of exhibitors."""
    assistant_name = "test_exhibitor_assistant"
    expected_exhibitors = [
        {"id": 1, "title": "Exhibitor A", "location": "Booth 1", "category": "Tech"},
        {"id": 2, "title": "Exhibitor B", "location": "Booth 2", "category": "Food"},
    ]
    mock_response = Response(
        200,
        json={"exhibitors": expected_exhibitors},
        request=Request("GET", f"{API_BASE_URL}/api/exhibitor"),
    )
    with patch(
        "ncp.services.utils.httpx.AsyncClient.get",
        AsyncMock(return_value=mock_response),
    ) as mock_get:
        exhibitors = await fetch_exhibitors_from_api(assistant_name)
        mock_get.assert_called_once_with(
            f"{API_BASE_URL}/api/exhibitor", params={"agent": assistant_name}
        )
        assert exhibitors == expected_exhibitors


@pytest.mark.asyncio
async def test_fetch_exhibitors_from_api_with_query() -> None:
    """Test successful fetching of exhibitors with query parameters."""
    assistant_name = "test_exhibitor_assistant"
    query_params = ["tech", "innovation"]
    expected_exhibitors = [
        {
            "id": 1,
            "title": "Filtered Exhibitor",
            "location": "Booth 3",
            "category": "Tech",
        }
    ]
    mock_response = Response(
        200,
        json={"exhibitors": expected_exhibitors},
        request=Request("GET", f"{API_BASE_URL}/api/exhibitor"),
    )
    with patch(
        "ncp.services.utils.httpx.AsyncClient.get",
        AsyncMock(return_value=mock_response),
    ) as mock_get:
        exhibitors = await fetch_exhibitors_from_api(assistant_name, query_params)
        mock_get.assert_called_once_with(
            f"{API_BASE_URL}/api/exhibitor",
            params={"agent": assistant_name, "query": "tech,innovation"},
        )
        assert exhibitors == expected_exhibitors


@pytest.mark.asyncio
async def test_fetch_exhibitors_from_api_http_error() -> None:
    """Test handling of HTTPStatusError for exhibitors."""
    assistant_name = "test_exhibitor_assistant"
    mock_get = AsyncMock(
        side_effect=HTTPStatusError(
            "Error", request=Request("GET", ""), response=Response(500)
        )
    )
    with patch("ncp.services.utils.httpx.AsyncClient.get", mock_get):
        exhibitors = await fetch_exhibitors_from_api(assistant_name)
        assert exhibitors == []


@pytest.mark.asyncio
async def test_fetch_exhibitors_from_api_request_error() -> None:
    """Test handling of RequestError for exhibitors."""
    assistant_name = "test_exhibitor_assistant"
    mock_get = AsyncMock(
        side_effect=RequestError("Connection failed", request=Request("GET", ""))
    )
    with patch("ncp.services.utils.httpx.AsyncClient.get", mock_get):
        exhibitors = await fetch_exhibitors_from_api(assistant_name)
        assert exhibitors == []


@pytest.mark.asyncio
async def test_fetch_exhibitors_from_api_no_exhibitors_key() -> None:
    """Test API response missing 'exhibitors' key."""
    assistant_name = "test_exhibitor_assistant"
    mock_response = Response(
        200,
        json={"data": "something_else"},  # No 'exhibitors' key
        request=Request("GET", f"{API_BASE_URL}/api/exhibitor"),
    )
    with patch(
        "ncp.services.utils.httpx.AsyncClient.get",
        AsyncMock(return_value=mock_response),
    ):
        exhibitors = await fetch_exhibitors_from_api(assistant_name)
        assert exhibitors == []


@pytest.mark.asyncio
async def test_fetch_individual_exhibitor_from_api_success() -> None:
    """Test successful fetching of a single exhibitor."""
    assistant_name = "test_assistant"
    exhibitor_title = "Awesome Corp"
    expected_exhibitor = {
        "id": "xyz",
        "title": "Awesome Corp",
        "location": "Hall A, Booth 101",
        "category": "Software",
        "description": "Leading software provider.",
        "exTags": ["cloud", "saas"],
    }
    mock_response = Response(
        200,
        json=expected_exhibitor,
        request=Request("GET", f"{API_BASE_URL}/api/exhibitorDetail"),
    )
    with patch(
        "ncp.services.utils.httpx.AsyncClient.get",
        AsyncMock(return_value=mock_response),
    ) as mock_get:
        exhibitor = await fetch_individual_exhibitor_from_api(
            assistant_name, exhibitor_title
        )
        mock_get.assert_called_once_with(
            f"{API_BASE_URL}/api/exhibitorDetail",
            params={"agent": assistant_name, "title": exhibitor_title},
        )
        assert exhibitor == expected_exhibitor


@pytest.mark.asyncio
async def test_fetch_individual_exhibitor_from_api_not_found() -> None:
    """Test fetching a non-existent exhibitor."""
    assistant_name = "test_assistant"
    exhibitor_title = "NonExistent Corp"
    mock_response = Response(
        404,
        json={"error": "Not Found"},
        request=Request("GET", f"{API_BASE_URL}/api/exhibitorDetail"),
    )
    mock_get = AsyncMock(
        side_effect=HTTPStatusError(
            "Not Found", request=Request("GET", ""), response=mock_response
        )
    )
    with patch("ncp.services.utils.httpx.AsyncClient.get", mock_get):
        exhibitor = await fetch_individual_exhibitor_from_api(
            assistant_name, exhibitor_title
        )
        assert exhibitor is None


# --- Tests for /showExhibitors endpoint ---


@patch("ncp.routers.exhibitor_routes.fetch_exhibitors_from_api", new_callable=AsyncMock)
def test_show_exhibitors_success_few_exhibitors(
    mock_fetch_exhibitors: AsyncMock,
) -> None:
    """Test /showExhibitors with fewer than 5 exhibitors."""
    assistant_name = "route_exhibitor_assistant"
    query = ["hardware"]
    mock_exhibitors_data = [
        {"title": "Exhibitor X", "location": "Section A", "category": "Hardware"},
        {"title": "Exhibitor Y", "location": "Section B", "category": "Hardware"},
    ]
    mock_fetch_exhibitors.return_value = mock_exhibitors_data

    response = client.post(
        "/showExhibitors",
        json={"assistantName": assistant_name, "query": query},
    )
    assert response.status_code == 200
    data = response.json()
    assert (
        "Here are the details of all exhibitors for query: hardware"
        in data["system_message"]
    )
    assert (
        "- Title: Exhibitor X\n  Location: Section A\n  Category: Hardware"
        in data["system_message"]
    )
    assert (
        "- Title: Exhibitor Y\n  Location: Section B\n  Category: Hardware"
        in data["system_message"]
    )
    assert data["metadata"]["request_info"]["params"]["agent"] == assistant_name
    assert data["metadata"]["request_info"]["params"]["query"] == "hardware"
    mock_fetch_exhibitors.assert_called_once_with(assistant_name, query)


@patch("ncp.routers.exhibitor_routes.fetch_exhibitors_from_api", new_callable=AsyncMock)
def test_show_exhibitors_success_many_exhibitors(
    mock_fetch_exhibitors: AsyncMock,
) -> None:
    """Test /showExhibitors with 5 or more exhibitors."""
    assistant_name = "route_exhibitor_assistant_many"
    mock_exhibitors_data = [
        {"title": f"Exhibitor {i}", "location": "Loc", "category": "Cat"}
        for i in range(6)
    ]
    mock_fetch_exhibitors.return_value = mock_exhibitors_data

    response = client.post("/showExhibitors", json={"assistantName": assistant_name})
    assert response.status_code == 200
    data = response.json()
    assert (
        "Here are the list of titles of all exhibitors: "
        "they are total 6 exhibitors" in data["system_message"]
    )
    for i in range(6):
        assert f"Exhibitor {i}" in data["system_message"]
    assert "for query:" not in data["system_message"]
    assert data["metadata"]["request_info"]["params"]["agent"] == assistant_name
    assert "query" not in data["metadata"]["request_info"]["params"]
    mock_fetch_exhibitors.assert_called_once_with(assistant_name, None)


@patch("ncp.routers.exhibitor_routes.fetch_exhibitors_from_api", new_callable=AsyncMock)
def test_show_exhibitors_no_exhibitors_found(
    mock_fetch_exhibitors: AsyncMock,
) -> None:
    """Test /showExhibitors when no exhibitors are found."""
    assistant_name = "route_exhibitor_empty"
    mock_fetch_exhibitors.return_value = []

    response = client.post("/showExhibitors", json={"assistantName": assistant_name})
    assert response.status_code == 200
    data = response.json()
    assert (
        data["system_message"]
        == "No exhibitor items found matching your query from the API."
    )
    mock_fetch_exhibitors.assert_called_once_with(assistant_name, None)


# --- Tests for /showIndividualExhibitor endpoint ---


@patch(
    "ncp.routers.exhibitor_routes.fetch_individual_exhibitor_from_api",
    new_callable=AsyncMock,
)
def test_show_individual_exhibitor_success(
    mock_fetch_exhibitor: AsyncMock,
) -> None:
    """Test /showIndividualExhibitor endpoint successfully returns exhibitor details."""
    assistant_name = "individual_exhibitor_assistant"
    exhibitor_title = "Innovate Solutions"
    mock_exhibitor_data = {
        "title": "Innovate Solutions",
        "location": "Booth Z10",
        "category": "Innovation",
        "description": "Cutting-edge solutions for tomorrow.",
        "exTags": ["future", "tech"],
    }
    mock_fetch_exhibitor.return_value = mock_exhibitor_data

    response = client.post(
        "/showIndividualExhibitor",
        json={"assistantName": assistant_name, "exhibitorTitle": exhibitor_title},
    )

    assert response.status_code == 200
    data = response.json()
    expected_message_part = (
        f"Here are the details for the exhibitor '{exhibitor_title}'"
    )
    assert expected_message_part in data["system_message"]
    assert f"- Title: {mock_exhibitor_data['title']}" in data["system_message"]
    assert f"- Location: {mock_exhibitor_data['location']}" in data["system_message"]
    assert f"- Category: {mock_exhibitor_data['category']}" in data["system_message"]
    assert (
        f"- Description: {mock_exhibitor_data['description']}" in data["system_message"]
    )
    assert "- Tags: future, tech" in data["system_message"]
    assert data["metadata"]["request_info"]["params"]["agent"] == assistant_name
    assert data["metadata"]["request_info"]["params"]["title"] == exhibitor_title
    mock_fetch_exhibitor.assert_called_once_with(assistant_name, exhibitor_title)


@patch(
    "ncp.routers.exhibitor_routes.fetch_individual_exhibitor_from_api",
    new_callable=AsyncMock,
)
def test_show_individual_exhibitor_not_found(
    mock_fetch_exhibitor: AsyncMock,
) -> None:
    """Test /showIndividualExhibitor endpoint when the exhibitor is not found."""
    assistant_name = "individual_exhibitor_empty"
    exhibitor_title = "Ghost Exhibitor"
    mock_fetch_exhibitor.return_value = None

    response = client.post(
        "/showIndividualExhibitor",
        json={"assistantName": assistant_name, "exhibitorTitle": exhibitor_title},
    )

    assert response.status_code == 200
    data = response.json()
    assert (
        data["system_message"]
        == f"No exhibitor found with the title '{exhibitor_title}'."
    )
    mock_fetch_exhibitor.assert_called_once_with(assistant_name, exhibitor_title)
