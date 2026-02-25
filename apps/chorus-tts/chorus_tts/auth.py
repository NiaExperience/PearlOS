# SPDX-License-Identifier: MIT
"""Authentication helpers for websocket connections."""

from __future__ import annotations

from fastapi import Header, HTTPException, Query, status
from fastapi.security.utils import get_authorization_scheme_param
from pydantic import BaseModel, ConfigDict, Field
from starlette.websockets import WebSocket

from .config import Settings


class SecuritySchemeConfig(BaseModel):
    """Describe a security scheme for AsyncAPI documentation."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=None)
    type: str
    description: str | None = None
    name: str | None = None
    location: str | None = Field(default=None, alias="in")
    scheme: str | None = None
    bearer_format: str | None = Field(default=None, alias="bearerFormat")


SECURITY_SCHEMES: dict[str, SecuritySchemeConfig] = {
    "XiApiKeyHeader": SecuritySchemeConfig.model_validate(
        {
            "type": "httpApiKey",
            "in": "header",
            "name": "xi-api-key",
            "description": "API key used by ElevenLabs clients (preferred).",
        },
    ),
    "ApiKeyQuery": SecuritySchemeConfig.model_validate(
        {
            "type": "httpApiKey",
            "in": "query",
            "name": "api_key",
            "description": "Fallback query parameter for API key authentication.",
        },
    ),
    "BearerAuth": SecuritySchemeConfig.model_validate(
        {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
            "description": (
                "Alternate bearer token accepted over the Authorization header."
            ),
        },
    ),
}

DEFAULT_SECURITY_SCHEMES: tuple[str, ...] = (
    "XiApiKeyHeader",
    "BearerAuth",
    "ApiKeyQuery",
)


class AuthenticationError(Exception):
    """Raised when an API key is missing or invalid."""


class APIKeyAuth:
    """Validate API keys against the list configured in Settings.

    ElevenLabs primary convention is the `xi-api-key` header. We also accept
    `Authorization: Bearer <token>` and `api_key` query parameter for
    compatibility.
    """

    def __init__(self, settings: Settings) -> None:
        """Initialize the authenticator with the configured API keys."""
        self._valid_keys = set(settings.api_keys)

    async def __call__(
        self,
        websocket: WebSocket,
        xi_api_key: str | None = Header(default=None, alias="xi-api-key"),
        authorization: str | None = Header(default=None, alias="Authorization"),
        api_key: str | None = Query(default=None, alias="api_key"),
    ) -> str:
        """Authenticate a websocket connection via dependency injection."""
        try:
            return self._authenticate(xi_api_key, authorization, api_key)
        except AuthenticationError as exc:  # pragma: no cover - handled by FastAPI
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unauthorized",
                headers={"x-error-code": "error.unauthorized"},
            ) from exc

    def authenticate_websocket(self, websocket: WebSocket) -> str:
        """Authenticate a websocket request using headers or query parameters."""
        xi_api_key = (
            websocket.headers.get("xi-api-key")
            if hasattr(websocket, "headers")
            else None
        )
        authorization = (
            websocket.headers.get("authorization")
            if hasattr(websocket, "headers")
            else None
        )
        api_key = websocket.query_params.get("api_key")
        return self._authenticate(xi_api_key, authorization, api_key)

    def _authenticate(
        self,
        xi_api_key: str | None,
        authorization: str | None,
        api_key: str | None,
    ) -> str:
        token = self._extract_key(xi_api_key, authorization, api_key)
        if not token or token not in self._valid_keys:
            message = "Invalid API key"
            raise AuthenticationError(message)
        return token

    @staticmethod
    def _extract_key(
        xi_api_key: str | None,
        authorization: str | None,
        api_key: str | None,
    ) -> str | None:
        if xi_api_key:
            return xi_api_key.strip()
        if authorization:
            scheme, param = get_authorization_scheme_param(authorization)
            if scheme.lower() == "bearer" and param:
                return param.strip()
        if api_key:
            return api_key.strip()
        return None

    @staticmethod
    def supported_schemes() -> tuple[str, ...]:
        """Return the security scheme identifiers supported by this authenticator."""
        return DEFAULT_SECURITY_SCHEMES
