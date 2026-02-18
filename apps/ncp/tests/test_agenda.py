from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from httpx import HTTPStatusError, Request, RequestError, Response

from ncp import app
from ncp.services.agenda_service import (
    fetch_agendas_from_api,
    fetch_individual_agenda_from_api,
)
from ncp.services.utils import API_BASE_URL  # Import API_BASE_URL from utils

# fetch_speakers_from_api, # Removed as speaker tests are moved


# --- Tests for agenda_service.py ---


@pytest.mark.asyncio
async def test_fetch_agendas_from_api_success() -> None:
    """Test successful fetching of agendas."""
    assistant_name = "test_assistant"
    expected_agendas = [{"id": 1, "title": "Agenda 1"}, {"id": 2, "title": "Agenda 2"}]

    mock_response = Response(
        200,
        json={"agendas": expected_agendas},
        request=Request("GET", f"{API_BASE_URL}/api/agendaList"),
    )

    with patch(
        "ncp.services.utils.httpx.AsyncClient.get",  # Corrected patch target
        AsyncMock(return_value=mock_response),
    ) as mock_get:
        agendas = await fetch_agendas_from_api(assistant_name)

        mock_get.assert_called_once_with(
            f"{API_BASE_URL}/api/agendaList", params={"agent": assistant_name}
        )
        assert agendas == expected_agendas


@pytest.mark.asyncio
async def test_fetch_agendas_from_api_with_query() -> None:
    """Test successful fetching of agendas with query parameters."""
    assistant_name = "test_assistant"
    query_params = ["category1", "category2"]
    expected_agendas = [{"id": 1, "title": "Filtered Agenda 1"}]

    mock_response = Response(
        200,
        json={"agendas": expected_agendas},
        request=Request("GET", f"{API_BASE_URL}/api/agendaList"),
    )

    with patch(
        "ncp.services.utils.httpx.AsyncClient.get",  # Corrected patch target
        AsyncMock(return_value=mock_response),
    ) as mock_get:
        agendas = await fetch_agendas_from_api(assistant_name, query_params)

        mock_get.assert_called_once_with(
            f"{API_BASE_URL}/api/agendaList",
            params={"agent": assistant_name, "query": "category1,category2"},
        )
        assert agendas == expected_agendas


@pytest.mark.asyncio
async def test_fetch_agendas_from_api_http_error() -> None:
    """Test handling of HTTPStatusError."""
    assistant_name = "test_assistant"

    mock_get = AsyncMock(
        side_effect=HTTPStatusError(
            "Error", request=Request("GET", ""), response=Response(500)
        )
    )

    with patch("ncp.services.utils.httpx.AsyncClient.get", mock_get):
        agendas = await fetch_agendas_from_api(assistant_name)
        assert agendas == []


@pytest.mark.asyncio
async def test_fetch_agendas_from_api_request_error() -> None:
    """Test handling of RequestError."""
    assistant_name = "test_assistant"

    mock_get = AsyncMock(
        side_effect=RequestError("Connection failed", request=Request("GET", ""))
    )

    with patch("ncp.services.utils.httpx.AsyncClient.get", mock_get):
        agendas = await fetch_agendas_from_api(assistant_name)
        assert agendas == []


@pytest.mark.asyncio
async def test_fetch_agendas_from_api_no_agendas_key() -> None:
    """Test API response missing 'agendas' key."""
    assistant_name = "test_assistant"
    mock_response = Response(
        200,
        json={"data": "something_else"},
        request=Request("GET", f"{API_BASE_URL}/api/agendaList"),
    )

    with patch(
        "ncp.services.utils.httpx.AsyncClient.get",  # Corrected patch target
        AsyncMock(return_value=mock_response),
    ):
        agendas = await fetch_agendas_from_api(assistant_name)
        assert agendas == []


# --- Tests for fetch_individual_agenda_from_api in agenda_service.py ---


@pytest.mark.asyncio
async def test_fetch_individual_agenda_from_api_success() -> None:
    """Test successful fetching of a single agenda item."""
    assistant_name = "test_assistant"
    agenda_title = "Specific Meeting"
    expected_agenda = {
        "id": 1,
        "title": "Specific Meeting",
        "track": "Main Track",
        "dayTime": "Monday 10:00 AM",
        "location": "Room 101",
        "type": "Session",
    }

    mock_response = Response(
        200,
        json=expected_agenda,
        request=Request("GET", f"{API_BASE_URL}/api/agendaDetail"),
    )

    with patch(
        "ncp.services.utils.httpx.AsyncClient.get",  # Corrected patch target
        AsyncMock(return_value=mock_response),
    ) as mock_get:
        agenda = await fetch_individual_agenda_from_api(assistant_name, agenda_title)

        mock_get.assert_called_once_with(
            f"{API_BASE_URL}/api/agendaDetail",
            params={"agent": assistant_name, "title": agenda_title},
        )
        assert agenda == expected_agenda


@pytest.mark.asyncio
async def test_fetch_individual_agenda_from_api_not_found() -> None:
    """Test fetching a non-existent agenda item."""
    assistant_name = "test_assistant"
    agenda_title = "Non Existent Meeting"

    mock_response = Response(
        404,
        json={"error": "Not Found"},  # Example 404 response
        request=Request("GET", f"{API_BASE_URL}/api/agendaDetail"),
    )
    mock_get = AsyncMock(
        side_effect=HTTPStatusError(
            "Not Found", request=Request("GET", ""), response=mock_response
        )
    )

    with patch("ncp.services.utils.httpx.AsyncClient.get", mock_get):
        agenda = await fetch_individual_agenda_from_api(assistant_name, agenda_title)
        assert agenda is None


@pytest.mark.asyncio
async def test_fetch_individual_agenda_from_api_http_error() -> None:
    """Test handling of HTTPStatusError for individual agenda."""
    assistant_name = "test_assistant"
    agenda_title = "Error Meeting"

    mock_get = AsyncMock(
        side_effect=HTTPStatusError(
            "Server Error", request=Request("GET", ""), response=Response(500)
        )
    )

    with patch("ncp.services.utils.httpx.AsyncClient.get", mock_get):
        agenda = await fetch_individual_agenda_from_api(assistant_name, agenda_title)
        assert agenda is None


@pytest.mark.asyncio
async def test_fetch_individual_agenda_from_api_request_error() -> None:
    """Test handling of RequestError for individual agenda."""
    assistant_name = "test_assistant"
    agenda_title = "Network Error Meeting"

    mock_get = AsyncMock(
        side_effect=RequestError("Connection failed", request=Request("GET", ""))
    )

    with patch("ncp.services.utils.httpx.AsyncClient.get", mock_get):
        agenda = await fetch_individual_agenda_from_api(assistant_name, agenda_title)
        assert agenda is None


# --- Tests for agenda_routes.py ---

client = TestClient(app)


@patch("ncp.routers.agenda_routes.fetch_agendas_from_api", new_callable=AsyncMock)
def test_show_agenda_success(mock_fetch_agendas: AsyncMock) -> None:
    """Test /showAgenda endpoint successfully returns agenda titles."""
    assistant_name = "route_assistant"
    mock_agendas_data = [
        {"title": "Meeting A", "description": "Discuss project A"},
        {"title": "Meeting B", "description": "Review project B"},
    ]
    mock_fetch_agendas.return_value = mock_agendas_data

    response = client.post(
        "/showAgenda", json={"assistantName": assistant_name, "query": ["cat1"]}
    )

    assert response.status_code == 200
    data = response.json()
    # Updated to reflect the standardized query string from the helper
    assert (
        "Here are the agenda item titles from the API for query: cat1"
        in data["system_message"]
    )
    assert "1. Meeting A" in data["system_message"]
    assert "2. Meeting B" in data["system_message"]
    assert data["metadata"]["request_info"]["params"]["agent"] == assistant_name
    mock_fetch_agendas.assert_called_once_with(assistant_name, ["cat1"])


@patch("ncp.routers.agenda_routes.fetch_agendas_from_api", new_callable=AsyncMock)
def test_show_agenda_no_agendas_found(mock_fetch_agendas: AsyncMock) -> None:
    """Test /showAgenda endpoint when no agendas are found by the service."""
    assistant_name = "route_assistant_empty"
    mock_fetch_agendas.return_value = []

    response = client.post("/showAgenda", json={"assistantName": assistant_name})

    assert response.status_code == 200
    data = response.json()
    assert (
        data["system_message"]
        == "No agenda items found matching your query from the API."
    )
    assert data["metadata"]["request_info"]["params"]["agent"] == assistant_name
    mock_fetch_agendas.assert_called_once_with(assistant_name, None)


@patch("ncp.routers.agenda_routes.fetch_agendas_from_api", new_callable=AsyncMock)
def test_show_agenda_no_query(mock_fetch_agendas: AsyncMock) -> None:
    """Test /showAgenda endpoint successfully returns agenda titles without a query."""
    assistant_name = "route_assistant_no_query"
    mock_agendas_data = [{"title": "General Meeting"}]
    mock_fetch_agendas.return_value = mock_agendas_data

    response = client.post("/showAgenda", json={"assistantName": assistant_name})

    assert response.status_code == 200
    data = response.json()
    assert (
        "Here are the agenda item titles from the API:\n\n1. General Meeting"
        in data["system_message"]
    )
    assert "for categories:" not in data["system_message"]
    assert data["metadata"]["request_info"]["params"]["agent"] == assistant_name
    mock_fetch_agendas.assert_called_once_with(assistant_name, None)


# --- Tests for /showIndividualAgenda endpoint in agenda_routes.py ---


@patch(
    "ncp.routers.agenda_routes.fetch_individual_agenda_from_api",
    new_callable=AsyncMock,
)
def test_show_individual_agenda_success(mock_fetch_agenda: AsyncMock) -> None:
    """Test /showIndividualAgenda endpoint successfully returns agenda details."""
    assistant_name = "individual_assistant"
    agenda_title = "My Specific Agenda"
    mock_agenda_data = {
        "title": "My Specific Agenda",
        "track": "Keynotes",
        "dayTime": "Tuesday 2:00 PM",
        "location": "Main Hall",
        "type": "Talk",
    }
    mock_fetch_agenda.return_value = mock_agenda_data

    response = client.post(
        "/showIndividualAgenda",
        json={"assistantName": assistant_name, "agendaTitle": agenda_title},
    )

    assert response.status_code == 200
    data = response.json()
    expected_message_part = f"Here are the details for the agenda item '{agenda_title}'"
    assert expected_message_part in data["system_message"]
    assert f"- Title: {mock_agenda_data['title']}" in data["system_message"]
    assert f"- Track: {mock_agenda_data['track']}" in data["system_message"]
    assert f"- Time: {mock_agenda_data['dayTime']}" in data["system_message"]
    assert f"- Location: {mock_agenda_data['location']}" in data["system_message"]
    assert f"- Type: {mock_agenda_data['type']}" in data["system_message"]
    assert data["metadata"]["request_info"]["params"]["agent"] == assistant_name
    assert data["metadata"]["request_info"]["params"]["title"] == agenda_title
    mock_fetch_agenda.assert_called_once_with(assistant_name, agenda_title)


@patch(
    "ncp.routers.agenda_routes.fetch_individual_agenda_from_api",
    new_callable=AsyncMock,
)
def test_show_individual_agenda_not_found(mock_fetch_agenda: AsyncMock) -> None:
    """Test /showIndividualAgenda endpoint when the agenda item is not found."""
    assistant_name = "individual_assistant_empty"
    agenda_title = "Missing Agenda"
    mock_fetch_agenda.return_value = None

    response = client.post(
        "/showIndividualAgenda",
        json={"assistantName": assistant_name, "agendaTitle": agenda_title},
    )

    assert response.status_code == 200
    data = response.json()
    assert (
        data["system_message"]
        == f"No agenda item found with the title '{agenda_title}'."
    )
    assert data["metadata"]["request_info"]["params"]["agent"] == assistant_name
    assert data["metadata"]["request_info"]["params"]["title"] == agenda_title
    mock_fetch_agenda.assert_called_once_with(assistant_name, agenda_title)
