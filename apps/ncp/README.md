# NCP - Nia Context Protocol Backend

## Description

NCP is a FastAPI backend service designed to provide processed information related to events, including agendas, speakers, exhibitors, and keyword-based lookups. It acts as an intermediary, fetching data from an external API and formatting it for use by conversational AI assistants.

## Prerequisites

*   Python 3.x
*   Dependencies listed in `requirements.txt` (FastAPI, Uvicorn, HTTPX, Pytest, etc.)

## Setup

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd <repository-root>/apps/ncp
    ```

2.  **Create and activate a virtual environment (recommended):**
    ```bash
    python -m venv ~/.venv/ncp
    source ~/.venv/ncp/bin/activate
    ```

3.  **Install dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

## Configuration

The base URL for the external API from which NCP fetches data is configured in `apps/ncp/ncp/services/utils.py`:

```python
API_BASE_URL = "http://localhost:3000"  # Centralized API base URL
```

Ensure this URL points to your running Next.js (or equivalent) backend that serves the `/api/*` endpoints NCP relies on.

## Running the Application

To start the FastAPI server, run the following command from the `apps/ncp/` directory:

```bash
uvicorn ncp:app --reload --port 8000
```

The server will typically be available at `http://127.0.0.1:8000`.

## API Endpoints

The following are the primary API endpoints provided by NCP. All endpoints are `POST` requests.

*   **Agendas:**
    *   `/showAgenda`
        *   Description: Fetches a list of agenda items. Can be filtered by query parameters.
        *   Request Body: `ShowAgendaRequest` (`assistantName: str`, `query: list[str] | None`)
    *   `/showIndividualAgenda`
        *   Description: Fetches details for a specific agenda item by title.
        *   Request Body: `ShowIndividualAgendaRequest` (`assistantName: str`, `agendaTitle: str`)

*   **Speakers:**
    *   `/showSpeakers`
        *   Description: Fetches a list of speakers. Can be filtered by query parameters.
        *   Request Body: `ShowSpeakersRequest` (`assistantName: str`, `query: list[str] | None`)
    *   `/showIndividualSpeaker`
        *   Description: Fetches details for a specific speaker by name.
        *   Request Body: `ShowIndividualSpeakerRequest` (`assistantName: str`, `speakerName: str`)

*   **Exhibitors:**
    *   `/showExhibitors`
        *   Description: Fetches a list of exhibitors. Can be filtered by query parameters.
        *   Request Body: `ShowExhibitorsRequest` (`assistantName: str`, `query: list[str] | None`)
    *   `/showIndividualExhibitor`
        *   Description: Fetches details for a specific exhibitor by title.
        *   Request Body: `ShowIndividualExhibitorRequest` (`assistantName: str`, `exhibitorTitle: str`)

*   **Keywords:**
    *   `/keywordMemoryLookup`
        *   Description: Looks up information related to a specific keyword.
        *   Request Body: `KeywordLookupRequest` (`assistantName: str`, `keyword: str`)
    *   `/IframeKeyword`
        *   Description: Fetches data (URL, name, description) for displaying content related to a keyword in an iframe.
        *   Request Body: `IframeKeywordRequest` (`assistantName: str`, `keyword: str`)

Each endpoint returns a JSON response containing a `system_message` (a user-friendly string with the fetched information) and `metadata` (including information about the original API request made by NCP).

## Running Tests

**Unit and Integration Tests (Pytest):**

To run the automated tests using Pytest, navigate to the `apps/ncp/` directory (or the project root if Pytest is configured to discover tests from there) and run:

```bash
pytest
```

This will execute all tests located in the `tests/` directory.

**Manual Endpoint Tests (Shell Scripts):**

Several shell scripts are provided in the `apps/ncp/scripts` directory to manually test the endpoints against a running NCP server. These scripts use `curl` to send requests.

*   `./test_agenda_ncp.sh`
*   `./test_exhibitor_ncp.sh`
*   `./test_keyword_ncp.sh`
*   `./test_speaker_ncp.sh`

Ensure the NCP server is running before executing these scripts. You might need to make them executable first (`chmod +x <script_name>.sh`).

## Project Structure

*   `ncp/__init__.py`: The main FastAPI application file, initializes the app and includes routers.
*   `ncp/routers/`: Contains modules that define API routes (e.g., `agenda_routes.py`, `speaker_routes.py`).
    *   `utils.py`: Shared utility functions for router handlers.
*   `ncp/services/`: Contains modules responsible for business logic, primarily fetching and processing data from the external API (e.g., `agenda_service.py`, `speaker_service.py`).
    *   `utils.py`: Shared utility functions for services, like `make_api_get_request`.
*   `tests/`: Contains Pytest test files for the services and routers (e.g., `test_agenda.py`, `test_speaker.py`).
*   `requirements.txt`: Lists production Python package dependencies.
*   `requirements_dev.txt`: Lists development Python package dependencies.
*   `scripts/*.sh`: Shell scripts for manual endpoint testing.
```
