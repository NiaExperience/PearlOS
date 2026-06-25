#!/usr/bin/env python3
"""Thin proxy between OpenClaw/Pipecat and DeepSeek API.
DISABLES thinking entirely: strips reasoning_config / reasoning from
requests and reasoning_content from prior assistant messages and from
non-streaming response bodies. This avoids DeepSeek v4's "reasoning_content
in the thinking mode must be passed back" 400 errors.
Also strips tool_choice and parallel_tool_calls — deepseek-reasoner
rejects them with 400 ("deepseek-reasoner does not support this tool_choice").
Preserves image_url blocks for DeepSeek vision-capable models.
Streams SSE chat completions through (no buffering).
For voice traffic (user="pearlos-voice"), forces thinking off via
`thinking={"type":"disabled"}` so the model emits content tokens
immediately. Empirically `reasoning_effort=low` ENABLES thinking on
deepseek-v4-flash (the proxy used to set it, which produced 50+
reasoning deltas before the first audible token); thinking:disabled is
the kill switch DeepSeek honors.
Listens on port 8200, forwards to api.deepseek.com.
"""
import base64, http.server, socketserver, json, urllib.request, urllib.error, ssl, os

LISTEN_PORT = int(os.environ.get("PROXY_PORT", "8200"))
DEEPSEEK_BASE = "https://api.deepseek.com"
OPENROUTER_BASE = os.environ.get("OPENROUTER_BASE", "https://openrouter.ai/api")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_VISION_MODEL = os.environ.get("DEEPSEEK_PROXY_VISION_MODEL", "google/gemini-3.1-flash-lite-preview")
VOICE_USER_TAGS = {"pearlos-voice", "voice"}
STREAM_CHUNK = 4096


class DeepSeekProxy(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    @staticmethod
    def _inline_remote_image(part: dict) -> dict:
        image_url = part.get("image_url")
        if not isinstance(image_url, dict):
            return part
        url = image_url.get("url")
        if not isinstance(url, str) or not url.startswith(("http://", "https://")):
            return part
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "PearlOS-DeepSeekProxy/1.0"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                content_type = resp.headers.get("Content-Type", "image/jpeg").split(";", 1)[0].strip()
                if not content_type.startswith("image/"):
                    return part
                data = resp.read(8 * 1024 * 1024 + 1)
                if len(data) > 8 * 1024 * 1024:
                    return part
            cloned = dict(part)
            cloned["image_url"] = {
                **image_url,
                "url": f"data:{content_type};base64,{base64.b64encode(data).decode('ascii')}",
            }
            return cloned
        except Exception:
            return part

    def _massage_request(self, body: bytes) -> tuple[bytes, bool, bool]:
        """Return (rewritten_body, is_stream, route_via_openrouter)."""
        is_stream = False
        route_via_openrouter = False
        try:
            j = json.loads(body)
            is_stream = bool(j.get("stream"))
            j.pop("reasoning_config", None)
            j.pop("reasoning", None)
            j.pop("tool_choice", None)
            j.pop("parallel_tool_calls", None)
            # DeepSeek's chat endpoint is used here as a speech-first fallback
            # for Discord/webchat. Some OpenClaw tool schemas are richer than
            # DeepSeek accepts, causing user-visible "provider rejected the
            # request schema or tool payload" failures. Drop client tool payloads
            # before forwarding so Pearl can still answer naturally.
            j.pop("tools", None)
            messages = []
            for msg in j.get("messages", []):
                if not isinstance(msg, dict) or msg.get("role") == "tool":
                    continue
                content = msg.get("content")
                if isinstance(content, list):
                    # OpenClaw stores content as Anthropic-style blocks:
                    # [{"type":"thinking","thinking":"...","thinkingSignature":"reasoning_content"},
                    #  {"type":"text","text":"actual response"}]
                    # DeepSeek needs: content="actual response", reasoning_content="..."
                    thinking_text = ""
                    text_parts = []
                    image_parts = []
                    for part in content:
                        ptype = part.get("type", "")
                        if ptype == "thinking" and part.get("thinkingSignature") == "reasoning_content":
                            thinking_text = part.get("thinking", "")
                        elif ptype == "text":
                            text_parts.append(part.get("text", ""))
                        elif ptype == "image_url":
                            image_parts.append(DeepSeekProxy._inline_remote_image(part))

                    if image_parts:
                        route_via_openrouter = True
                        rebuilt = [{"type": "text", "text": " ".join(text_parts)}] if text_parts else []
                        rebuilt.extend(image_parts)
                        msg["content"] = rebuilt if rebuilt else ""
                    elif text_parts:
                        msg["content"] = " ".join(text_parts)
                    else:
                        msg["content"] = ""

                    # Restore reasoning_content for DeepSeek
                    if thinking_text and msg.get("role") == "assistant":
                        msg["reasoning_content"] = thinking_text

                if msg.get("role") == "assistant":
                    msg.pop("tool_calls", None)
                    if msg.get("content") is None:
                        msg["content"] = ""
                    # If assistant message has no reasoning_content and content is None/empty,
                    # this was a tool_call message where OpenClaw stripped reasoning.
                    # Add a placeholder so DeepSeek doesn't reject it.
                    rc = msg.get("reasoning_content")
                    if not isinstance(rc, str) or not rc:
                        msg["reasoning_content"] = "(prior reasoning omitted)"
                messages.append(msg)
            j["messages"] = messages
            # Disable thinking for ALL requests, not just voice.
            # DeepSeek's hidden reasoning chain adds 30-120s of latency
            # before any visible content token for Discord/chat traffic.
            j.pop("reasoning_effort", None)
            j["thinking"] = {"type": "disabled"}
            if route_via_openrouter:
                j.pop("thinking", None)
                # Most OpenRouter vision fallbacks are reliable for multimodal
                # chat, but provider/tool support varies. For image-bearing
                # Discord turns, prefer a plain vision answer over forwarding a
                # tool schema that can make the provider reject the request.
                j.pop("tools", None)
                j.pop("tool_choice", None)
                j.pop("parallel_tool_calls", None)
                model = str(j.get("model") or "")
                if model in ("deepseek-v4-pro", "pearl-llm/deepseek-v4-pro", "deepseek-v4-flash", "pearl-llm/deepseek-v4-flash"):
                    j["model"] = OPENROUTER_VISION_MODEL
            return json.dumps(j).encode(), is_stream, route_via_openrouter
        except (json.JSONDecodeError, KeyError, TypeError):
            return body, is_stream, route_via_openrouter

    def _strip_response_reasoning(self, data: bytes) -> bytes:
        """Strip reasoning_content from non-streaming response choices."""
        try:
            j = json.loads(data)
        except (json.JSONDecodeError, TypeError):
            return data
        choices = j.get("choices")
        if not isinstance(choices, list):
            return data
        for choice in choices:
            if not isinstance(choice, dict):
                continue
            msg = choice.get("message")
            if isinstance(msg, dict):
                msg.pop("reasoning_content", None)
            delta = choice.get("delta")
            if isinstance(delta, dict):
                delta.pop("reasoning_content", None)
        return json.dumps(j).encode()

    def _filter_sse_line(self, raw: bytes) -> bytes:
        """For SSE `data: {json}` lines, strip reasoning_content from delta/message.

        DeepSeek occasionally leaks reasoning_content deltas even with
        thinking={"type":"disabled"}; downstream chat clients render those
        tokens as user-visible content, so we drop the field at the proxy.
        Non-data lines, [DONE] markers, and unparseable payloads pass through.
        """
        line = raw.rstrip(b"\r\n")
        if not line.startswith(b"data: "):
            return raw
        payload = line[6:]
        if not payload or payload == b"[DONE]":
            return raw
        try:
            j = json.loads(payload)
        except (json.JSONDecodeError, TypeError):
            return raw
        changed = False
        choices = j.get("choices")
        if isinstance(choices, list):
            for choice in choices:
                if not isinstance(choice, dict):
                    continue
                delta = choice.get("delta")
                if isinstance(delta, dict) and "reasoning_content" in delta:
                    delta.pop("reasoning_content", None)
                    changed = True
                msg = choice.get("message")
                if isinstance(msg, dict) and "reasoning_content" in msg:
                    msg.pop("reasoning_content", None)
                    changed = True
        if not changed:
            return raw
        eol = b"\r\n" if raw.endswith(b"\r\n") else (b"\n" if raw.endswith(b"\n") else b"")
        return b"data: " + json.dumps(j).encode() + eol

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        body, is_stream, route_via_openrouter = self._massage_request(body)

        base_url = OPENROUTER_BASE if route_via_openrouter else DEEPSEEK_BASE
        url = f"{base_url}{self.path}"
        headers = {k: v for k, v in self.headers.items()
                   if k.lower() in ("authorization", "content-type")}
        if route_via_openrouter:
            if not OPENROUTER_API_KEY:
                err = json.dumps({"error": "OPENROUTER_API_KEY is required for image requests"}).encode()
                self.send_response(502)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(err)))
                self.send_header("Connection", "close")
                self.end_headers()
                try: self.wfile.write(err)
                except (BrokenPipeError, ConnectionResetError): pass
                return
            headers["Authorization"] = f"Bearer {OPENROUTER_API_KEY}"
            headers["HTTP-Referer"] = "https://pearlos.app"
            headers["X-Title"] = "PearlOS"
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        ctx = ssl.create_default_context()

        try:
            resp = urllib.request.urlopen(req, context=ctx, timeout=120)
        except urllib.error.HTTPError as e:
            err_body = e.read()
            if e.code == 400:
                import sys
                msg = err_body.decode()[:300]
                print(f"PROXY 400: {msg}", file=sys.stderr, flush=True)
                # Also log the request body that caused the error
                try:
                    req_json = json.loads(body)
                    msgs = req_json.get("messages", [])
                    for m in msgs:
                        if m.get("role") == "assistant":
                            print(f"PROXY 400 ASSISTANT MSG KEYS: {list(m.keys())}", file=sys.stderr, flush=True)
                            print(f"PROXY 400 CONTENT TYPE: {type(m.get('content')).__name__}", file=sys.stderr, flush=True)
                except Exception:
                    pass
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(err_body)))
            self.send_header("Connection", "close")
            self.end_headers()
            try: self.wfile.write(err_body)
            except (BrokenPipeError, ConnectionResetError): pass
            return
        except Exception as e:
            err = json.dumps({"error": str(e)}).encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(err)))
            self.send_header("Connection", "close")
            self.end_headers()
            try: self.wfile.write(err)
            except (BrokenPipeError, ConnectionResetError): pass
            return

        try:
            if is_stream:
                self.send_response(resp.status)
                ct = resp.headers.get("Content-Type", "text/event-stream")
                self.send_header("Content-Type", ct)
                self.send_header("Cache-Control", "no-cache, no-transform")
                self.send_header("X-Accel-Buffering", "no")
                self.send_header("Connection", "close")
                self.end_headers()
                while True:
                    line = resp.readline()
                    if not line:
                        break
                    out = self._filter_sse_line(line)
                    try:
                        self.wfile.write(out)
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError):
                        break
            else:
                data = resp.read()
                ct = resp.headers.get("Content-Type", "application/json")
                if "json" in ct.lower():
                    data = self._strip_response_reasoning(data)
                self.send_response(resp.status)
                self.send_header("Content-Type", ct)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Connection", "close")
                self.end_headers()
                try: self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError): pass
        finally:
            try: resp.close()
            except Exception: pass

    def do_GET(self):
        url = f"{DEEPSEEK_BASE}{self.path}"
        headers = {k: v for k, v in self.headers.items()
                   if k.lower() in ("authorization",)}
        req = urllib.request.Request(url, headers=headers)
        ctx = ssl.create_default_context()
        try:
            with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Connection", "close")
                self.end_headers()
                try: self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError): pass
        except Exception as e:
            err = json.dumps({"error": str(e)}).encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(err)))
            self.send_header("Connection", "close")
            self.end_headers()
            try: self.wfile.write(err)
            except (BrokenPipeError, ConnectionResetError): pass

    def log_message(self, format, *args):
        import sys
        sys.stderr.write(f"PROXY: {format % args}\n")
        sys.stderr.flush()


class ThreadingProxyServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    server = ThreadingProxyServer(("127.0.0.1", LISTEN_PORT), DeepSeekProxy)
    print(f"DeepSeek proxy on 127.0.0.1:{LISTEN_PORT} → {DEEPSEEK_BASE}", flush=True)
    server.serve_forever()
