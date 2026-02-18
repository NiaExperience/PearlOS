from typing import Any

import httpx

API_BASE_URL = "http://localhost:3000"  # Centralized API base URL


async def make_api_get_request(
    url: str, params: dict[str, str]
) -> dict[str, Any] | None:
    """
    Makes a GET request to the specified API endpoint.

    Handles common HTTP errors and returns the JSON response as a dictionary
    or None if an error occurs or the response is empty. Prints error details.
    """
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, params=params)
            response.raise_for_status()  # Raise for HTTP errors (4xx or 5xx)
            # Ensure that json() is only called on non-empty responses if necessary,
            # though httpx typically handles this. An empty JSON body might be {}.
            data = response.json()
            return data if isinstance(data, dict) else None
        except httpx.HTTPStatusError as e:
            error_message = (
                f"HTTP error for URL {url} with params {params}: "
                f"{e.response.status_code} - {e.response.text}"
            )
            print(error_message)
            return None
        except httpx.RequestError as e:
            print(f"Request error occurred for URL {url} with params {params}: {e}")
            return None
        except Exception as e:  # Catch other potential errors, e.g., JSONDecodeError
            print(
                f"An unexpected error occurred for URL {url} with params {params}: {e}"
            )
            return None
