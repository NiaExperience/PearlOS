from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from httpx import HTTPStatusError, Request, RequestError, Response

from ncp import app
from ncp.services.speaker_service import (
    fetch_individual_speaker_from_api,
    fetch_speakers_from_api,
)
from ncp.services.utils import API_BASE_URL  # Import API_BASE_URL from utils

client = TestClient(app)

# --- Tests for fetch_speakers_from_api in agenda_service.py ---


@pytest.mark.asyncio
async def test_fetch_speakers_from_api_success() -> None:
    """Test successful fetching of speakers."""
    assistant_name = "test_speaker_assistant"
    expected_speakers = [
        {"id": 1, "name": "Speaker 1", "title": "CEO", "company": "Org A"},
        {"id": 2, "name": "Speaker 2", "title": "Dev", "company": "Org B"},
    ]
    mock_response = Response(
        200,
        json={"speakers": expected_speakers},
        request=Request("GET", f"{API_BASE_URL}/api/speakerList"),
    )
    with patch(
        "ncp.services.utils.httpx.AsyncClient.get",  # Corrected patch target
        AsyncMock(return_value=mock_response),
    ) as mock_get:
        speakers = await fetch_speakers_from_api(assistant_name)
        mock_get.assert_called_once_with(
            f"{API_BASE_URL}/api/speakerList", params={"agent": assistant_name}
        )
        assert speakers == expected_speakers


@pytest.mark.asyncio
async def test_fetch_speakers_from_api_with_query() -> None:
    """Test successful fetching of speakers with query parameters."""
    assistant_name = "test_speaker_assistant"
    query_params = ["topic1", "topic2"]
    expected_speakers = [
        {"id": 1, "name": "Filtered Speaker 1", "title": "Expert", "company": "Org C"}
    ]
    mock_response = Response(
        200,
        json={"speakers": expected_speakers},
        request=Request("GET", f"{API_BASE_URL}/api/speakerList"),
    )
    with patch(
        "ncp.services.utils.httpx.AsyncClient.get",  # Corrected patch target
        AsyncMock(return_value=mock_response),
    ) as mock_get:
        speakers = await fetch_speakers_from_api(assistant_name, query_params)
        mock_get.assert_called_once_with(
            f"{API_BASE_URL}/api/speakerList",
            params={"agent": assistant_name, "query": "topic1,topic2"},
        )
        assert speakers == expected_speakers


@pytest.mark.asyncio
async def test_fetch_speakers_from_api_http_error() -> None:
    """Test handling of HTTPStatusError for speakers."""
    assistant_name = "test_speaker_assistant"
    mock_get = AsyncMock(
        side_effect=HTTPStatusError(
            "Error", request=Request("GET", ""), response=Response(500)
        )
    )
    with patch("ncp.services.utils.httpx.AsyncClient.get", mock_get):
        speakers = await fetch_speakers_from_api(assistant_name)
        assert speakers == []


@pytest.mark.asyncio
async def test_fetch_speakers_from_api_request_error() -> None:
    """Test handling of RequestError for speakers."""
    assistant_name = "test_speaker_assistant"
    mock_get = AsyncMock(
        side_effect=RequestError("Connection failed", request=Request("GET", ""))
    )
    with patch("ncp.services.utils.httpx.AsyncClient.get", mock_get):
        speakers = await fetch_speakers_from_api(assistant_name)
        assert speakers == []


@pytest.mark.asyncio
async def test_fetch_speakers_from_api_no_speakers_key() -> None:
    """Test API response missing 'speakers' key."""
    assistant_name = "test_speaker_assistant"
    mock_response = Response(
        200,
        json={"data": "something_else"},  # No 'speakers' key
        request=Request("GET", f"{API_BASE_URL}/api/speakerList"),
    )
    with patch(
        "ncp.services.utils.httpx.AsyncClient.get",  # Corrected patch target
        AsyncMock(return_value=mock_response),
    ):
        speakers = await fetch_speakers_from_api(assistant_name)
        assert speakers == []


# --- Tests for fetch_individual_speaker_from_api in speaker_service.py ---


@pytest.mark.asyncio
async def test_fetch_individual_speaker_from_api_success() -> None:
    """Test successful fetching of a single speaker."""
    assistant_name = "test_assistant"
    speaker_name = "John Doe"
    expected_speaker = {
        "id": "123",
        "name": "John Doe",
        "title": "CEO",
        "company": "Acme Corp",
        "session": "Keynote",
        "dayTime": "Mon 9 AM",
        "bio": "Experienced leader.",
    }
    mock_response = Response(
        200,
        json=expected_speaker,
        request=Request("GET", f"{API_BASE_URL}/api/speakerDetail"),
    )
    with patch(
        "ncp.services.utils.httpx.AsyncClient.get",
        AsyncMock(return_value=mock_response),
    ) as mock_get:
        speaker = await fetch_individual_speaker_from_api(assistant_name, speaker_name)
        mock_get.assert_called_once_with(
            f"{API_BASE_URL}/api/speakerDetail",
            params={"agent": assistant_name, "name": speaker_name},
        )
        assert speaker == expected_speaker


@pytest.mark.asyncio
async def test_fetch_individual_speaker_from_api_not_found() -> None:
    """Test fetching a non-existent speaker."""
    assistant_name = "test_assistant"
    speaker_name = "Unknown Speaker"
    mock_response = Response(
        404,
        json={"error": "Not Found"},
        request=Request("GET", f"{API_BASE_URL}/api/speakerDetail"),
    )
    mock_get = AsyncMock(
        side_effect=HTTPStatusError(
            "Not Found", request=Request("GET", ""), response=mock_response
        )
    )
    with patch("ncp.services.utils.httpx.AsyncClient.get", mock_get):
        speaker = await fetch_individual_speaker_from_api(assistant_name, speaker_name)
        assert speaker is None


@pytest.mark.asyncio
async def test_fetch_individual_speaker_from_api_http_error() -> None:
    """Test handling of HTTPStatusError for individual speaker."""
    assistant_name = "test_assistant"
    speaker_name = "Error Speaker"
    mock_get = AsyncMock(
        side_effect=HTTPStatusError(
            "Server Error", request=Request("GET", ""), response=Response(500)
        )
    )
    with patch("ncp.services.utils.httpx.AsyncClient.get", mock_get):
        speaker = await fetch_individual_speaker_from_api(assistant_name, speaker_name)
        assert speaker is None


@pytest.mark.asyncio
async def test_fetch_individual_speaker_from_api_request_error() -> None:
    """Test handling of RequestError for individual speaker."""
    assistant_name = "test_assistant"
    speaker_name = "Network Error Speaker"
    mock_get = AsyncMock(
        side_effect=RequestError("Connection failed", request=Request("GET", ""))
    )
    with patch("ncp.services.utils.httpx.AsyncClient.get", mock_get):
        speaker = await fetch_individual_speaker_from_api(assistant_name, speaker_name)
        assert speaker is None


# --- Tests for /showSpeakers endpoint ---


@patch("ncp.routers.speaker_routes.fetch_speakers_from_api", new_callable=AsyncMock)
def test_show_speakers_success_few_speakers(mock_fetch_speakers: AsyncMock) -> None:
    """Test /showSpeakers with fewer than 5 speakers."""
    assistant_name = "route_speaker_assistant"
    query = ["tech"]
    mock_speakers_data = [
        {"name": "Speaker A", "title": "Lead", "company": "Comp A"},
        {"name": "Speaker B", "title": "Manager", "company": "Comp B"},
    ]
    mock_fetch_speakers.return_value = mock_speakers_data

    response = client.post(
        "/showSpeakers",
        json={"assistantName": assistant_name, "query": query},
    )
    assert response.status_code == 200
    data = response.json()
    assert (
        "Here are the details of all speakers for query: tech" in data["system_message"]
    )
    assert (
        "- Name: Speaker A\n  Title: Lead\n  Company: Comp A" in data["system_message"]
    )
    assert (
        "- Name: Speaker B\n  Title: Manager\n  Company: Comp B"
        in data["system_message"]
    )
    assert data["metadata"]["request_info"]["params"]["agent"] == assistant_name
    assert data["metadata"]["request_info"]["params"]["query"] == "tech"
    mock_fetch_speakers.assert_called_once_with(assistant_name, query)


@patch("ncp.routers.speaker_routes.fetch_speakers_from_api", new_callable=AsyncMock)
def test_show_speakers_success_many_speakers(mock_fetch_speakers: AsyncMock) -> None:
    """Test /showSpeakers with 5 or more speakers."""
    assistant_name = "route_speaker_assistant_many"
    mock_speakers_data = [
        {"name": f"Speaker {i}", "title": "Title", "company": "Company"}
        for i in range(6)
    ]
    mock_fetch_speakers.return_value = mock_speakers_data

    response = client.post("/showSpeakers", json={"assistantName": assistant_name})
    assert response.status_code == 200
    data = response.json()
    assert (
        "Here are the list of names of all speakers: they are total 6 speakers"
        in data["system_message"]
    )
    for i in range(6):
        assert f"Speaker {i}" in data["system_message"]
    assert "for query:" not in data["system_message"]  # No query in this case
    assert data["metadata"]["request_info"]["params"]["agent"] == assistant_name
    assert "query" not in data["metadata"]["request_info"]["params"]
    mock_fetch_speakers.assert_called_once_with(assistant_name, None)


@patch("ncp.routers.speaker_routes.fetch_speakers_from_api", new_callable=AsyncMock)
def test_show_speakers_no_speakers_found(mock_fetch_speakers: AsyncMock) -> None:
    """Test /showSpeakers when no speakers are found."""
    assistant_name = "route_speaker_empty"
    mock_fetch_speakers.return_value = []

    response = client.post("/showSpeakers", json={"assistantName": assistant_name})
    assert response.status_code == 200
    data = response.json()
    assert (
        data["system_message"]
        == "No speaker items found matching your query from the API."
    )
    assert data["metadata"]["request_info"]["params"]["agent"] == assistant_name
    mock_fetch_speakers.assert_called_once_with(assistant_name, None)


# --- Tests for /showIndividualSpeaker endpoint in speaker_routes.py ---


@patch(
    "ncp.routers.speaker_routes.fetch_individual_speaker_from_api",
    new_callable=AsyncMock,
)
def test_show_individual_speaker_success(mock_fetch_speaker: AsyncMock) -> None:
    """Test /showIndividualSpeaker endpoint successfully returns speaker details."""
    assistant_name = "individual_speaker_assistant"
    speaker_name = "Jane Doe"
    mock_speaker_data = {
        "name": "Jane Doe",
        "title": "CTO",
        "company": "Innovate LLC",
        "session": "Tech Trends",
        "dayTime": "Tue 3 PM",
        "bio": "Loves coding.",
    }
    mock_fetch_speaker.return_value = mock_speaker_data

    response = client.post(
        "/showIndividualSpeaker",
        json={"assistantName": assistant_name, "speakerName": speaker_name},
    )

    assert response.status_code == 200
    data = response.json()
    expected_message_part = f"Here are the details for the speaker '{speaker_name}'"
    assert expected_message_part in data["system_message"]
    assert f"- Name: {mock_speaker_data['name']}" in data["system_message"]
    assert f"- Title: {mock_speaker_data['title']}" in data["system_message"]
    assert f"- Company: {mock_speaker_data['company']}" in data["system_message"]
    assert f"- Session: {mock_speaker_data['session']}" in data["system_message"]
    assert f"- Schedule: {mock_speaker_data['dayTime']}" in data["system_message"]
    assert f"- Bio: {mock_speaker_data['bio']}" in data["system_message"]
    assert data["metadata"]["request_info"]["params"]["agent"] == assistant_name
    assert data["metadata"]["request_info"]["params"]["name"] == speaker_name
    mock_fetch_speaker.assert_called_once_with(assistant_name, speaker_name)


@patch(
    "ncp.routers.speaker_routes.fetch_individual_speaker_from_api",
    new_callable=AsyncMock,
)
def test_show_individual_speaker_not_found(mock_fetch_speaker: AsyncMock) -> None:
    """Test /showIndividualSpeaker endpoint when the speaker is not found."""
    assistant_name = "individual_speaker_empty"
    speaker_name = "Missing Speaker"
    mock_fetch_speaker.return_value = None

    response = client.post(
        "/showIndividualSpeaker",
        json={"assistantName": assistant_name, "speakerName": speaker_name},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["system_message"] == f"No speaker found with the name '{speaker_name}'."
    assert data["metadata"]["request_info"]["params"]["agent"] == assistant_name
    assert data["metadata"]["request_info"]["params"]["name"] == speaker_name
    mock_fetch_speaker.assert_called_once_with(assistant_name, speaker_name)


@patch("ncp.routers.speaker_routes.fetch_speakers_from_api", new_callable=AsyncMock)
def test_show_speakers_no_query(mock_fetch_speakers: AsyncMock) -> None:
    """Test /showSpeakers returns details successfully without a query."""
    assistant_name = "route_speaker_no_query"
    mock_speakers_data = [
        {"name": "General Speaker", "title": "Keynote", "company": "Events Inc."}
    ]
    mock_fetch_speakers.return_value = mock_speakers_data

    response = client.post("/showSpeakers", json={"assistantName": assistant_name})
    assert response.status_code == 200
    data = response.json()
    expected_details = (
        "Here are the details of all speakers:\n\n"
        "- Name: General Speaker\n  Title: Keynote\n  Company: Events Inc."
    )
    assert expected_details in data["system_message"]
    assert "for query:" not in data["system_message"]
    assert data["metadata"]["request_info"]["params"]["agent"] == assistant_name
    mock_fetch_speakers.assert_called_once_with(assistant_name, None)
