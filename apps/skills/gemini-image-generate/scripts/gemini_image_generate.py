#!/usr/bin/env python3
"""Gemini Image Generate - CLI for PearlOS image generation.

Calls Google's Gemini API to generate images, with optional reference image
for style transfer / layout preservation.

Expected interface:
  python gemini_image_generate.py \
    --prompt "..." \
    --model <model_name> \
    --out-dir /tmp/xxx \
    --cleanup \
    [--aspect-ratio 16:9] \
    [--reference-image /path/to/ref.webp]

Environment:
  GEMINI_API_KEY  - Google AI API key (required)
  GEMINI_MODEL    - override model name (optional, --model takes precedence)

Output (last line of stdout):
  {"files": ["/tmp/xxx/generated_0.png"]}
"""

import argparse
import base64
import json
import mimetypes
import os
import sys
import tempfile
import shutil
import urllib.error
import urllib.request
from pathlib import Path

try:
    from google import genai
    from google.genai import types
    HAS_GENAI = True
except ImportError:
    HAS_GENAI = False


def detect_mime(path: str) -> str:
    mt, _ = mimetypes.guess_type(path)
    if mt:
        return mt
    ext = os.path.splitext(path)[1].lower()
    return {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }.get(ext, "image/png")


def model_for_openrouter(model: str) -> str:
    explicit = os.environ.get("OPENROUTER_IMAGE_MODEL", "").strip()
    if explicit:
        return explicit
    normalized = (model or "").strip().lower()
    if normalized in {"", "nanobanana-pro", "nano-banana-pro-preview", "gemini-3-pro-image"}:
        return "openai/gpt-5.4-image-2"
    if normalized in {"nanobanana-2", "gemini-2.5-flash-image"}:
        return "bytedance-seed/seedream-4.5"
    if "/" in normalized:
        return model
    return "openai/gpt-5.4-image-2"


def data_url_for_file(path: str) -> str:
    mime = detect_mime(path)
    with open(path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def generate_via_openrouter(prompt: str, model: str, out_dir: str, aspect_ratio: str = "", reference_image: str = ""):
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        return None

    prompt_text = prompt
    if aspect_ratio:
        prompt_text += f"\nTarget aspect ratio: {aspect_ratio}."

    content = [{"type": "text", "text": prompt_text}]
    if reference_image and os.path.exists(reference_image):
        content.append({"type": "image_url", "image_url": {"url": data_url_for_file(reference_image)}})

    body = {
        "model": model_for_openrouter(model),
        "modalities": ["image", "text"],
        "messages": [{"role": "user", "content": content}],
    }
    if aspect_ratio:
        body["image_config"] = {"aspect_ratio": aspect_ratio, "image_size": "2K"}

    request = urllib.request.Request(
        os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/") + "/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "HTTP-Referer": "https://pearlos.org",
            "X-Title": "PearlOS Image Generate",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        print(f"ERROR: OpenRouter returned {e.code}: {detail[:500]}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: OpenRouter request failed: {e}", file=sys.stderr)
        sys.exit(1)

    if payload.get("error"):
        print(f"ERROR: OpenRouter error: {payload['error']}", file=sys.stderr)
        sys.exit(1)

    image_url = (
        payload.get("choices", [{}])[0]
        .get("message", {})
        .get("images", [{}])[0]
        .get("image_url", {})
        .get("url")
    )
    if not image_url or not image_url.startswith("data:"):
        print("ERROR: OpenRouter returned no image", file=sys.stderr)
        sys.exit(1)

    header, encoded = image_url.split(",", 1)
    mime = header.split(";", 1)[0].replace("data:", "") or "image/png"
    ext = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
    }.get(mime, ".png")
    out_path = os.path.join(out_dir, f"generated_0{ext}")
    with open(out_path, "wb") as f:
        f.write(base64.b64decode(encoded))
    print(json.dumps({"files": [out_path], "provider": "openrouter", "model": body["model"]}, ensure_ascii=False))
    return True


def main():
    parser = argparse.ArgumentParser(description="Generate image via Gemini API")
    parser.add_argument("--prompt", required=True, help="Generation prompt")
    parser.add_argument("--model", default="", help="Model name")
    parser.add_argument("--out-dir", required=True, help="Output directory")
    parser.add_argument("--cleanup", action="store_true", help="(ignored, kept for compat)")
    parser.add_argument("--aspect-ratio", default="", help="Aspect ratio hint (e.g. 16:9)")
    parser.add_argument("--reference-image", default="", help="Reference image path")
    args = parser.parse_args()

    # Resolve model - env var GEMINI_MODEL overrides --model flag
    model = os.environ.get("GEMINI_MODEL", "").strip() or args.model.strip()
    if not model:
        model = "gemini-2.0-flash-exp"

    # Ensure output directory
    out_dir = args.out_dir
    os.makedirs(out_dir, exist_ok=True)

    if generate_via_openrouter(args.prompt, model, out_dir, args.aspect_ratio, args.reference_image):
        return

    # Resolve API key
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        api_key = os.environ.get("GOOGLE_API_KEY", "").strip()
    if not api_key:
        print("ERROR: OPENROUTER_API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    if not HAS_GENAI:
        print("ERROR: google-genai package not installed", file=sys.stderr)
        sys.exit(1)

    # Initialize client
    client = genai.Client(api_key=api_key)

    # Build prompt parts
    contents = []

    # Add reference image if provided
    if args.reference_image and os.path.exists(args.reference_image):
        ref_path = args.reference_image
        mime = detect_mime(ref_path)
        with open(ref_path, "rb") as f:
            ref_data = f.read()
        contents.append(
            types.Part.from_bytes(data=ref_data, mime_type=mime)
        )

    # Add text prompt
    prompt_text = args.prompt
    if args.aspect_ratio:
        prompt_text += f"\nTarget aspect ratio: {args.aspect_ratio}."
    contents.append(prompt_text)

    # Configure generation
    generate_config = types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
    )

    try:
        response = client.models.generate_content(
            model=model,
            contents=contents,
            config=generate_config,
        )
    except Exception as e:
        err_msg = str(e)
        print(f"ERROR: {err_msg}", file=sys.stderr)
        sys.exit(1)

    # Extract generated images
    output_files = []
    idx = 0

    if response.candidates:
        for candidate in response.candidates:
            if not candidate.content or not candidate.content.parts:
                continue
            for part in candidate.content.parts:
                if part.inline_data and part.inline_data.mime_type and part.inline_data.mime_type.startswith("image/"):
                    # Determine extension from mime
                    mime = part.inline_data.mime_type
                    ext_map = {
                        "image/png": ".png",
                        "image/jpeg": ".jpg",
                        "image/webp": ".webp",
                    }
                    ext = ext_map.get(mime, ".png")
                    out_path = os.path.join(out_dir, f"generated_{idx}{ext}")
                    with open(out_path, "wb") as f:
                        f.write(part.inline_data.data)
                    output_files.append(out_path)
                    idx += 1

    if not output_files:
        # Check if there's text response with error info
        text_parts = []
        if response.candidates:
            for candidate in response.candidates:
                if candidate.content and candidate.content.parts:
                    for part in candidate.content.parts:
                        if part.text:
                            text_parts.append(part.text)
        if text_parts:
            print(f"ERROR: No image generated. Model response: {' '.join(text_parts)[:500]}", file=sys.stderr)
        else:
            print("ERROR: No image generated and no text response", file=sys.stderr)
        sys.exit(1)

    # Output result as JSON (backend reads the last line)
    result = {"files": output_files}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
