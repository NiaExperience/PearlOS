"""Unit tests for bot tool decorators.

Tests the @bot_tool decorator to ensure:
1. Metadata is correctly attached to functions
2. Async/sync function behavior is preserved
3. Default values are applied correctly
4. Function signatures and attributes are maintained
"""
from __future__ import annotations

import asyncio
import inspect

import pytest
from tools.decorators import bot_tool


class TestBotToolDecorator:
    """Test suite for @bot_tool decorator."""
    
    def test_decorator_adds_metadata(self):
        """Test that decorator adds required metadata attributes."""
        @bot_tool(
            name="test_tool",
            description="Test description",
            feature_flag="test"
        )
        async def test_handler():
            return "result"
        
        assert hasattr(test_handler, '_is_bot_tool')
        assert test_handler._is_bot_tool is True
        assert hasattr(test_handler, '_tool_metadata')
        assert isinstance(test_handler._tool_metadata, dict)
    
    def test_decorator_stores_name(self):
        """Test that tool name is stored correctly."""
        @bot_tool(
            name="test_tool_name",
            description="Test",
            feature_flag="test"
        )
        async def test_handler():
            pass
        
        assert test_handler._tool_metadata["name"] == "test_tool_name"
    
    def test_decorator_stores_description(self):
        """Test that description is stored correctly."""
        @bot_tool(
            name="test",
            description="This is a test description",
            feature_flag="test"
        )
        async def test_handler():
            pass
        
        assert test_handler._tool_metadata["description"] == "This is a test description"
    
    def test_decorator_stores_feature_flag(self):
        """Test that feature_flag is stored correctly."""
        @bot_tool(
            name="test",
            description="Test",
            feature_flag="notes"
        )
        async def test_handler():
            pass
        
        assert test_handler._tool_metadata["feature_flag"] == "notes"
    
    def test_decorator_with_parameters(self):
        """Test that custom parameters schema is stored."""
        params = {
            "type": "object",
            "properties": {
                "arg1": {"type": "string", "description": "First arg"},
                "arg2": {"type": "number", "description": "Second arg"}
            },
            "required": ["arg1"]
        }
        
        @bot_tool(
            name="test_tool_params",
            description="Test",
            feature_flag="test",
            parameters=params
        )
        async def test_handler():
            pass
        
        assert test_handler._tool_metadata["parameters"] == params
    
    def test_decorator_default_parameters(self):
        """Test that default empty parameters schema is applied."""
        @bot_tool(
            name="test",
            description="Test",
            feature_flag="test"
        )
        async def test_handler():
            pass
        
        expected_params = {
            "type": "object",
            "properties": {},
            "required": []
        }
        assert test_handler._tool_metadata["parameters"] == expected_params
    
    def test_decorator_passthrough_flag(self):
        """Test that passthrough flag is stored correctly."""
        @bot_tool(
            name="test",
            description="Test",
            feature_flag="test",
            passthrough=True
        )
        async def test_handler():
            pass
        
        assert test_handler._tool_metadata["passthrough"] is True
    
    def test_decorator_default_passthrough(self):
        """Test that passthrough defaults to False."""
        @bot_tool(
            name="test",
            description="Test",
            feature_flag="test"
        )
        async def test_handler():
            pass
        
        assert test_handler._tool_metadata["passthrough"] is False
    
    @pytest.mark.asyncio
    async def test_decorator_preserves_async_behavior(self):
        """Test that async functions remain async and execute correctly."""
        @bot_tool(
            name="test",
            description="Test",
            feature_flag="test"
        )
        async def async_func():
            await asyncio.sleep(0.01)
            return "async_result"
        
        # Verify it's still async
        assert inspect.iscoroutinefunction(async_func)
        
        # Verify it executes correctly
        result = await async_func()
        assert result == "async_result"
    
    def test_decorator_preserves_sync_behavior(self):
        """Test that sync functions remain sync and execute correctly."""
        @bot_tool(
            name="test",
            description="Test",
            feature_flag="test"
        )
        def sync_func():
            return "sync_result"
        
        # Verify it's not async
        assert not inspect.iscoroutinefunction(sync_func)
        
        # Verify it executes correctly
        result = sync_func()
        assert result == "sync_result"
    
    @pytest.mark.asyncio
    async def test_decorator_preserves_async_with_args(self):
        """Test that async functions with arguments work correctly."""
        @bot_tool(
            name="test",
            description="Test",
            feature_flag="test"
        )
        async def async_func_with_args(x: int, y: int) -> int:
            await asyncio.sleep(0.01)
            return x + y
        
        result = await async_func_with_args(5, 3)
        assert result == 8
    
    def test_decorator_preserves_sync_with_args(self):
        """Test that sync functions with arguments work correctly."""
        @bot_tool(
            name="test",
            description="Test",
            feature_flag="test"
        )
        def sync_func_with_args(x: int, y: int) -> int:
            return x * y
        
        result = sync_func_with_args(4, 7)
        assert result == 28
    
    @pytest.mark.asyncio
    async def test_decorator_preserves_async_with_kwargs(self):
        """Test that async functions with keyword arguments work correctly."""
        @bot_tool(
            name="test",
            description="Test",
            feature_flag="test"
        )
        async def async_func_with_kwargs(name: str, age: int = 0) -> str:
            await asyncio.sleep(0.01)
            return f"{name} is {age}"
        
        result = await async_func_with_kwargs(name="Alice", age=30)
        assert result == "Alice is 30"
    
    def test_decorator_preserves_function_name(self):
        """Test that __name__ attribute is preserved."""
        @bot_tool(
            name="test",
            description="Test",
            feature_flag="test"
        )
        async def my_handler_function():
            pass
        
        assert my_handler_function.__name__ == "my_handler_function"
    
    def test_decorator_preserves_docstring(self):
        """Test that __doc__ attribute is preserved."""
        @bot_tool(
            name="test",
            description="Test",
            feature_flag="test"
        )
        async def documented_function():
            """This is a test docstring."""
            pass
        
        assert documented_function.__doc__ == "This is a test docstring."
    
    def test_decorator_with_all_options(self):
        """Test decorator with all optional parameters specified."""
        params = {
            "type": "object",
            "properties": {"key": {"type": "string"}},
            "required": ["key"]
        }
        
        @bot_tool(
            name="full_test",
            description="Full test description",
            feature_flag="misc",
            parameters=params,
            passthrough=True,
        )
        async def full_handler():
            return "full"
        
        meta = full_handler._tool_metadata
        assert meta["name"] == "full_test"
        assert meta["description"] == "Full test description"
        assert meta["feature_flag"] == "misc"
        assert meta["parameters"] == params
        assert meta["passthrough"] is True
    
    def test_multiple_decorated_functions(self):
        """Test that multiple decorated functions have independent metadata."""
        @bot_tool(
            name="tool_one",
            description="First tool",
            feature_flag="notes"
        )
        async def handler_one():
            pass
        
        @bot_tool(
            name="tool_two",
            description="Second tool",
            feature_flag="window"
        )
        async def handler_two():
            pass
        
        assert handler_one._tool_metadata["name"] == "tool_one"
        assert handler_one._tool_metadata["feature_flag"] == "notes"
        
        assert handler_two._tool_metadata["name"] == "tool_two"
        assert handler_two._tool_metadata["feature_flag"] == "window"
    
    def test_decorator_can_be_called_multiple_times(self):
        """Test that decorator factory can create multiple decorators."""
        decorator1 = bot_tool(name="test1", description="Test 1", feature_flag="test")
        decorator2 = bot_tool(name="test2", description="Test 2", feature_flag="test")
        
        @decorator1
        async def func1():
            return "func1"
        
        @decorator2
        async def func2():
            return "func2"
        
        assert func1._tool_metadata["name"] == "test1"
        assert func2._tool_metadata["name"] == "test2"
