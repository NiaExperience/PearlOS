"""
Task control tools for managing OpenClaw sub-agents and background tasks.
Allows users to stop/pause/kill running agents via voice or UI.
"""
import os
import logging
import aiohttp
from typing import Literal

from bot.tools.base import bot_tool

logger = logging.getLogger(__name__)

OPENCLAW_BASE_URL = os.getenv("OPENCLAW_BASE_URL", "http://localhost:18789")
OPENCLAW_API_KEY = os.getenv("OPENCLAW_API_KEY")

@bot_tool(
    name="bot_stop_task",
    description="Stop or cancel a running background task or sub-agent. Use when user says 'stop that', 'cancel the task', 'kill it', etc.",
    feature_flag="openclawBridge"
)
async def bot_stop_task(
    task_label: str,
    action: Literal["stop", "cancel", "kill"] = "stop"
) -> dict:
    """
    Stop a running OpenClaw sub-agent or background task.
    
    Args:
        task_label: Label/name of the task to stop (e.g., "Call Button Fix")
        action: Action to take - "stop" (graceful), "cancel", or "kill" (force)
    
    Returns:
        Status of the stop operation
    """
    try:
        # Get list of active sessions
        headers = {}
        if OPENCLAW_API_KEY:
            headers["Authorization"] = f"Bearer {OPENCLAW_API_KEY}"
        
        async with aiohttp.ClientSession() as session:
            # List sessions to find matching label
            async with session.get(
                f"{OPENCLAW_BASE_URL}/api/sessions",
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                if resp.status != 200:
                    return {
                        "status": "error",
                        "message": f"Failed to list sessions: {resp.status}"
                    }
                
                data = await resp.json()
                sessions = data.get("sessions", [])
                
                # Find session with matching label
                target_session = None
                for s in sessions:
                    session_label = s.get("label", "")
                    session_key = s.get("key", "")
                    # Match by label or key containing the task_label
                    if (task_label.lower() in session_label.lower() or 
                        task_label.lower() in session_key.lower()):
                        target_session = s
                        break
                
                if not target_session:
                    return {
                        "status": "not_found",
                        "message": f"No active task found matching '{task_label}'"
                    }
                
                session_key = target_session["key"]
                
                # Send abort/stop signal
                # OpenClaw doesn't have a direct "kill session" API yet,
                # but we can send a stop message to the session
                async with session.post(
                    f"{OPENCLAW_BASE_URL}/v1/chat/completions",
                    headers={**headers, "Content-Type": "application/json"},
                    json={
                        "model": "default",
                        "messages": [
                            {
                                "role": "system",
                                "content": f"User requested to {action} this task. Stop all work immediately and report status."
                            }
                        ],
                        "stream": False,
                        "x-openclaw-session-key": session_key
                    },
                    timeout=aiohttp.ClientTimeout(total=15)
                ) as stop_resp:
                    if stop_resp.status == 200:
                        return {
                            "status": "stopped",
                            "message": f"Sent {action} signal to task '{task_label}'",
                            "session_key": session_key
                        }
                    else:
                        return {
                            "status": "error",
                            "message": f"Failed to stop task: {stop_resp.status}"
                        }
    
    except Exception as e:
        logger.error(f"[bot_stop_task] Error: {e}", exc_info=True)
        return {
            "status": "error",
            "message": f"Failed to stop task: {str(e)}"
        }


@bot_tool(
    name="bot_list_tasks",
    description="List all running background tasks and sub-agents",
    feature_flag="openclawBridge"
)
async def bot_list_tasks() -> dict:
    """
    Get list of all currently running OpenClaw sessions/tasks.
    
    Returns:
        List of active tasks with labels and status
    """
    try:
        headers = {}
        if OPENCLAW_API_KEY:
            headers["Authorization"] = f"Bearer {OPENCLAW_API_KEY}"
        
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{OPENCLAW_BASE_URL}/api/sessions",
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                if resp.status != 200:
                    return {
                        "status": "error",
                        "message": f"Failed to list sessions: {resp.status}"
                    }
                
                data = await resp.json()
                sessions = data.get("sessions", [])
                
                # Filter to sub-agents and background tasks (exclude main sessions)
                tasks = []
                for s in sessions:
                    key = s.get("key", "")
                    label = s.get("label", "")
                    # Include sessions that look like sub-agents
                    if "subagent:" in key or label:
                        tasks.append({
                            "label": label or key.split(":")[-1],
                            "key": key,
                            "model": s.get("model", "unknown"),
                            "started": s.get("updatedAt"),
                            "tokens": s.get("totalTokens", 0)
                        })
                
                return {
                    "status": "success",
                    "count": len(tasks),
                    "tasks": tasks
                }
    
    except Exception as e:
        logger.error(f"[bot_list_tasks] Error: {e}", exc_info=True)
        return {
            "status": "error",
            "message": f"Failed to list tasks: {str(e)}"
        }
