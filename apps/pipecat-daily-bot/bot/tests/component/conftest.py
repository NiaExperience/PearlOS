import pytest

@pytest.fixture(scope="session", autouse=True)
def mesh_test_server():
    """Override parent fixture to disable Mesh server startup."""
    yield
