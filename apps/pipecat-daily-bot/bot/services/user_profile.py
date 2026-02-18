"""User profile loading service for Daily bot integration.

Handles async profile loading from mesh_client with error handling, caching,
and integration with Daily participant metadata flow.
"""

from __future__ import annotations

import asyncio
from typing import Any

from loguru import logger

try:
    from actions import profile_actions
    logger.info(f"[profile_service] Successfully imported profile_actions: {profile_actions}")
except ImportError as e:
    profile_actions = None
    logger.warning(f"profile_actions not available - user profile loading disabled. Error: {e}")


class UserProfileService:
    """Service for loading user profiles from mesh_client when session.user.id is available.

    Provides async profile loading with error handling, basic caching to avoid
    redundant lookups during a session, and fallback behavior when mesh_client
    is unavailable.
    """

    def __init__(self):
        """Initialize the profile service with an empty cache."""
        self._profile_cache: dict[str, dict[str, Any] | None] = {}
        self._loading_requests: set[str] = set()
        # Optional fetched-at timestamps to enable selective refresh if needed
        self._fetched_at: dict[str, float] = {}

    async def load_user_profile(
        self, user_id: str, user_email: str | None = None
    ) -> dict[str, Any] | None:
        """Load user profile for the given user ID with optional email fallback.

        Args:
            user_id: The authenticated user ID from session metadata
            user_email: Optional email to try as a fallback lookup if userId misses

        Returns:
            Dictionary containing user profile data or None if unavailable
        """
        if not user_id or not isinstance(user_id, str):
            return None

        user_id = user_id.strip()
        if not user_id:
            return None

        # Check cache first
        if user_id in self._profile_cache:
            logger.debug(f"[profile_service] cache hit for user_id={user_id}")
            return self._profile_cache[user_id]

        # Avoid duplicate concurrent requests for same user
        if user_id in self._loading_requests:
            logger.debug(f"[profile_service] concurrent request in progress for user_id={user_id}")
            # Wait briefly for concurrent request to complete
            for _ in range(10):  # Max 1 second wait
                await asyncio.sleep(0.1)
                if user_id in self._profile_cache:
                    return self._profile_cache[user_id]
            # If still not cached, proceed with our own request

        try:
            self._loading_requests.add(user_id)
            logger.info(f"[profile_service] loading profile for user_id={user_id}")

            if profile_actions is None:
                logger.warning(
                    f"[profile_service] profile_actions unavailable, cannot load profile for user_id={user_id}"
                )
                self._profile_cache[user_id] = None
                return None

            # Load profile from mesh_client with email fallback
            # Only include email fallback when provided to keep tests/mocks compatible
            if user_email:
                profile_data = await self._fetch_profile(user_id, user_email)
            else:
                profile_data = await self._fetch_profile(user_id)

            # Cache the result (including None for failed lookups)
            self._profile_cache[user_id] = profile_data
            try:
                # Record fetch time for potential TTL-based refresh (future use)
                import time as _time

                self._fetched_at[user_id] = _time.time()
            except Exception:
                pass

            if profile_data:
                logger.info(f"[profile_service] successfully loaded profile for user_id={user_id}")
            else:
                logger.warning(f"[profile_service] no profile found for user_id={user_id}")

            return profile_data

        except Exception as e:
            logger.error(f"[profile_service] error loading profile for user_id={user_id}: {e}")
            # Do not poison cache if error likely due to mock signature mismatch
            self._profile_cache[user_id] = None
            return None
        finally:
            self._loading_requests.discard(user_id)

    async def _fetch_profile(
        self, user_id: str, user_email: str | None = None
    ) -> dict[str, Any] | None:
        """Fetch user profile using the actions layer with optional email fallback."""
        if profile_actions is None:
            return None

        try:
            profile = await profile_actions.get_user_profile(user_id)
            if profile:
                return profile

            if user_email:
                logger.info(
                    f"User profile not found by userId {user_id}, trying email fallback: {user_email}"
                )
                profile = await profile_actions.get_user_profile_by_email(user_email)
                if profile:
                    logger.info(
                        f"Successfully found user profile by email fallback for {user_email}"
                    )
                    return profile

            logger.info(
                f"No user profile found for user_id={user_id}"
                + (f" or email={user_email}" if user_email else "")
            )
            return None

        except Exception as e:
            logger.error(f"Error fetching user profile for user_id={user_id}: {e}")
            return None

    def get_cached_profile(self, session_user_id: str) -> dict[str, Any] | None:
        """Get cached profile data without triggering a new load.

        Args:
            session_user_id: The authenticated user ID from session metadata

        Returns:
            Cached profile data or None if not cached
        """
        if not session_user_id or not isinstance(session_user_id, str):
            return None

        user_id = session_user_id.strip()
        return self._profile_cache.get(user_id)

    def clear_cache(self) -> None:
        """Clear the profile cache. Useful for testing or memory management."""
        self._profile_cache.clear()
        self._fetched_at.clear()
        logger.debug("[profile_service] profile cache cleared")

    # --- New: fine-grained cache control + reload helpers -------------------
    def clear_profile(self, user_id: str) -> None:
        """Clear cached profile for a specific user, if present.

        Safe no-op if the entry does not exist or input is invalid.
        """
        try:
            if not user_id or not isinstance(user_id, str):
                return
            key = user_id.strip()
            if not key:
                return
            if key in self._profile_cache:
                del self._profile_cache[key]
            if key in self._fetched_at:
                del self._fetched_at[key]
            logger.debug(f"[profile_service] cleared cache for user_id={key}")
        except Exception:
            # never raise from cache maintenance
            pass

    async def reload_user_profile(
        self, user_id: str, user_email: str | None = None
    ) -> dict[str, Any] | None:
        """Force a fresh load of the user's profile by clearing cache first.

        Returns the newly loaded profile (or None on miss/error).
        """
        self.clear_profile(user_id)
        return await self.load_user_profile(user_id, user_email)


# Global instance for use across the bot
_profile_service_instance: UserProfileService | None = None


def get_profile_service() -> UserProfileService:
    """Get the global UserProfileService instance."""
    global _profile_service_instance
    if _profile_service_instance is None:
        _profile_service_instance = UserProfileService()
    return _profile_service_instance
