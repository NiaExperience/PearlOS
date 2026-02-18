#!/usr/bin/env python3
"""Quick test for Photo Magic ComfyUI pipeline."""

import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from comfyui_client import generate_image, edit_image


async def main():
    output_dir = "/tmp/photo-magic-test"

    # Test 1: Text-to-image
    print("=" * 60)
    print("TEST 1: Text-to-image generation")
    print("=" * 60)
    prompt = "A cute orange cat sitting on a windowsill, golden hour sunlight, photorealistic 4k"
    print(f"Prompt: {prompt}")
    path = await generate_image(prompt, output_dir=output_dir)
    print(f"✅ Generated image: {path}")
    assert os.path.isfile(path), f"Output file not found: {path}"
    print(f"   File size: {os.path.getsize(path)} bytes")

    # Test 2: Image edit (use the generated image as input)
    print()
    print("=" * 60)
    print("TEST 2: Image edit")
    print("=" * 60)
    edit_prompt = "Make the cat wear a tiny top hat and monocle, keep everything else the same"
    print(f"Input: {path}")
    print(f"Prompt: {edit_prompt}")
    edited_path = await edit_image(edit_prompt, path, output_dir=output_dir)
    print(f"✅ Edited image: {edited_path}")
    assert os.path.isfile(edited_path), f"Output file not found: {edited_path}"
    print(f"   File size: {os.path.getsize(edited_path)} bytes")

    print()
    print("All tests passed! 🎉")


if __name__ == "__main__":
    asyncio.run(main())
