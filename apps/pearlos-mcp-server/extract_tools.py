#!/usr/bin/env python3
"""Extract PearlOS bot tool definitions for MCP server generation.

Walks the pipecat bot tools directory, parses @bot_tool decorators via AST,
and outputs a JSON manifest of all tool schemas.
"""
import ast
import json
import os
import re
import sys


def extract_dict_from_source(source_lines, start_line, start_col):
    """Extract a dict literal from source starting at given position."""
    text = "\n".join(source_lines[start_line:])
    # Find the opening brace
    brace_count = 0
    started = False
    result = []
    for ch in text[start_col:]:
        if ch == '{':
            brace_count += 1
            started = True
        elif ch == '}':
            brace_count -= 1
        if started:
            result.append(ch)
        if started and brace_count == 0:
            break
    raw = "".join(result)
    # Clean for JSON
    raw = re.sub(r'#.*?\n', '\n', raw)
    raw = re.sub(r',\s*}', '}', raw)
    raw = re.sub(r',\s*]', ']', raw)
    # Handle Python True/False/None
    raw = raw.replace("True", "true").replace("False", "false").replace("None", "null")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def extract_tools(bot_dir):
    tools_dir = os.path.join(bot_dir, "tools")
    tools = []

    for root, dirs, files in os.walk(tools_dir):
        for f in files:
            if not f.endswith(".py") or f.startswith("__"):
                continue
            path = os.path.join(root, f)
            with open(path) as fh:
                source = fh.read()
                source_lines = source.split("\n")

            try:
                tree = ast.parse(source)
            except SyntaxError:
                continue

            for node in ast.walk(tree):
                if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                for dec in node.decorator_list:
                    if not isinstance(dec, ast.Call):
                        continue
                    func = dec.func
                    if not (isinstance(func, ast.Name) and func.id == "bot_tool"):
                        continue

                    tool = {"file": os.path.relpath(path, bot_dir), "handler": node.name}
                    for kw in dec.keywords:
                        if kw.arg == "name" and isinstance(kw.value, ast.Constant):
                            tool["name"] = kw.value.value
                        elif kw.arg == "description" and isinstance(kw.value, ast.Constant):
                            tool["description"] = kw.value.value
                        elif kw.arg == "feature_flag" and isinstance(kw.value, ast.Constant):
                            tool["feature_flag"] = kw.value.value
                        elif kw.arg == "passthrough" and isinstance(kw.value, ast.Constant):
                            tool["passthrough"] = kw.value.value
                        elif kw.arg == "parameters":
                            # Try to extract the dict from source
                            params = extract_dict_from_source(
                                source_lines,
                                kw.value.lineno - 1,
                                kw.value.col_offset,
                            )
                            if params:
                                tool["parameters"] = params

                    if "name" in tool:
                        tools.append(tool)

    # Deduplicate by name (keep first occurrence)
    seen = set()
    unique = []
    for t in sorted(tools, key=lambda x: x["name"]):
        if t["name"] not in seen:
            seen.add(t["name"])
            unique.append(t)

    return unique


if __name__ == "__main__":
    bot_dir = sys.argv[1] if len(sys.argv) > 1 else "/workspace/nia-universal/apps/pipecat-daily-bot/bot"
    tools = extract_tools(bot_dir)
    
    output = {
        "version": "1.0.0",
        "source": "pipecat-daily-bot",
        "count": len(tools),
        "tools": tools,
    }
    
    json.dump(output, sys.stdout, indent=2)
    print()
