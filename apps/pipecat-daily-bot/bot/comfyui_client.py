"""ComfyUI async client for Photo Magic — text-to-image and image editing via Qwen."""

import os
import json
import uuid
import asyncio
import aiohttp
from pathlib import Path
from loguru import logger

COMFYUI_URL = os.getenv("COMFYUI_URL", "http://localhost:8188")
COMFYUI_OUTPUT_DIR = "/workspace/runpod-slim/ComfyUI/output"
CHECKPOINT = "Qwen-Rapid-AIO-SFW-v23.safetensors"


# ---------------------------------------------------------------------------
# Workflow builders — return the API-format prompt dict
# ---------------------------------------------------------------------------

def _build_txt2img_workflow(prompt: str) -> dict:
    """Text-to-image (no input photo): EmptyLatentImage → KSamplerAdvanced → VAEDecode → SaveImage.

    Uses Pearl Photo Magic v.04 node IDs and settings.
    """
    return {
        # Checkpoint loader
        "1032": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": CHECKPOINT},
        },
        # Prompt
        "970": {
            "class_type": "String Literal",
            "inputs": {"string": prompt},
        },
        # POSITIVE conditioning (no images for txt2img)
        "1430": {
            "class_type": "TextEncodeQwenImageEditPlus",
            "inputs": {
                "clip": ["1032", 1],
                "vae": ["1032", 2],
                "prompt": ["970", 0],
            },
        },
        # NEGATIVE conditioning (empty, no images)
        "1418": {
            "class_type": "TextEncodeQwenImageEditPlus",
            "inputs": {
                "clip": ["1032", 1],
                "vae": ["1032", 2],
                "prompt": "",
            },
        },
        # Empty latent (no input image)
        "1423": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": 1600, "height": 1000, "batch_size": 1},
        },
        # KSamplerAdvanced
        "1417": {
            "class_type": "KSamplerAdvanced",
            "inputs": {
                "model": ["1032", 0],
                "positive": ["1430", 0],
                "negative": ["1418", 0],
                "latent_image": ["1423", 0],
                "noise_seed": _rand_seed(),
                "add_noise": "enable",
                "steps": 12,
                "cfg": 1,
                "sampler_name": "euler",
                "scheduler": "simple",
                "start_at_step": 0,
                "end_at_step": 10000,
                "return_with_leftover_noise": "disable",
            },
        },
        # VAEDecode
        "1427": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["1417", 0],
                "vae": ["1032", 2],
            },
        },
        # SaveImage
        "1432": {
            "class_type": "SaveImage",
            "inputs": {
                "images": ["1427", 0],
                "filename_prefix": "ComfyUI",
            },
        },
    }


def _build_edit_workflow(prompt: str, image_names: list[str]) -> dict:
    """Image edit using Pearl Photo Magic v.04 workflow.

    Image1 → POSITIVE TextEncode + VAEEncode (latent).
    Image2/3 → POSITIVE TextEncode only (references).
    NEGATIVE TextEncode gets clip+vae only, no images, empty prompt.
    KSamplerAdvanced with v.04 settings.
    """
    # Image node IDs matching workflow
    image_node_ids = ["1407", "1439", "1440"]

    wf: dict = {
        # Checkpoint loader
        "1032": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": CHECKPOINT},
        },
        # Prompt
        "970": {
            "class_type": "String Literal",
            "inputs": {"string": prompt},
        },
    }

    # Load images
    for i, name in enumerate(image_names[:3]):
        wf[image_node_ids[i]] = {
            "class_type": "LoadImage",
            "inputs": {"image": name},
        }

    # VAEEncode first image for latent
    wf["1423"] = {
        "class_type": "VAEEncode",
        "inputs": {
            "pixels": [image_node_ids[0], 0],
            "vae": ["1032", 2],
        },
    }

    # POSITIVE TextEncodeQwenImageEditPlus with images
    pos_inputs: dict = {
        "clip": ["1032", 1],
        "vae": ["1032", 2],
        "prompt": ["970", 0],
    }
    for i in range(min(len(image_names), 3)):
        pos_inputs[f"image{i+1}"] = [image_node_ids[i], 0]

    wf["1430"] = {
        "class_type": "TextEncodeQwenImageEditPlus",
        "inputs": pos_inputs,
    }

    # NEGATIVE TextEncodeQwenImageEditPlus (no images, empty prompt)
    wf["1418"] = {
        "class_type": "TextEncodeQwenImageEditPlus",
        "inputs": {
            "clip": ["1032", 1],
            "vae": ["1032", 2],
            "prompt": "",
        },
    }

    # KSamplerAdvanced
    wf["1417"] = {
        "class_type": "KSamplerAdvanced",
        "inputs": {
            "model": ["1032", 0],
            "positive": ["1430", 0],
            "negative": ["1418", 0],
            "latent_image": ["1423", 0],
            "noise_seed": _rand_seed(),
            "add_noise": "enable",
            "steps": 12,
            "cfg": 1,
            "sampler_name": "euler",
            "scheduler": "simple",
            "start_at_step": 0,
            "end_at_step": 10000,
            "return_with_leftover_noise": "disable",
        },
    }

    # VAEDecode
    wf["1427"] = {
        "class_type": "VAEDecode",
        "inputs": {"samples": ["1417", 0], "vae": ["1032", 2]},
    }

    # SaveImage
    wf["1432"] = {
        "class_type": "SaveImage",
        "inputs": {"images": ["1427", 0], "filename_prefix": "ComfyUI"},
    }

    return wf


def _rand_seed() -> int:
    import random
    return random.randint(0, 2**53)


# ---------------------------------------------------------------------------
# ComfyUI API helpers
# ---------------------------------------------------------------------------

async def _upload_image(session: aiohttp.ClientSession, image_path: str) -> str:
    """Upload an image to ComfyUI, return the server-side filename."""
    path = Path(image_path)
    form = aiohttp.FormData()
    form.add_field("image", open(path, "rb"), filename=path.name, content_type="image/png")
    form.add_field("overwrite", "true")

    async with session.post(f"{COMFYUI_URL}/api/upload/image", data=form) as resp:
        resp.raise_for_status()
        data = await resp.json()
        name = data["name"]
        logger.info(f"[comfyui] Uploaded {path.name} → {name}")
        return name


async def _queue_prompt(session: aiohttp.ClientSession, workflow: dict, client_id: str) -> str:
    """Submit a workflow to ComfyUI, return prompt_id."""
    payload = {"prompt": workflow, "client_id": client_id}
    async with session.post(f"{COMFYUI_URL}/api/prompt", json=payload) as resp:
        resp.raise_for_status()
        data = await resp.json()
        prompt_id = data["prompt_id"]
        logger.info(f"[comfyui] Queued prompt {prompt_id}")
        return prompt_id


async def _wait_for_completion(prompt_id: str, client_id: str, timeout: float = 600) -> dict:
    """Wait for prompt completion by polling history endpoint. Returns history entry."""
    poll_interval = 2.0
    elapsed = 0.0

    async with aiohttp.ClientSession() as session:
        while elapsed < timeout:
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

            try:
                async with session.get(f"{COMFYUI_URL}/api/history/{prompt_id}") as resp:
                    if resp.status == 200:
                        history = await resp.json()
                        entry = history.get(prompt_id)
                        if entry and entry.get("outputs"):
                            logger.info(f"[comfyui] Prompt {prompt_id} completed after {elapsed:.0f}s")
                            return entry
            except Exception as e:
                logger.warning(f"[comfyui] Poll error: {e}")

            # Also check if it's still queued/running
            if elapsed % 30 < poll_interval:
                try:
                    async with session.get(f"{COMFYUI_URL}/api/queue") as resp:
                        q = await resp.json()
                        running_ids = [x[1] for x in q.get("queue_running", [])]
                        pending_ids = [x[1] for x in q.get("queue_pending", [])]
                        if prompt_id not in running_ids and prompt_id not in pending_ids:
                            # Not in queue and not in history = might have errored
                            async with session.get(f"{COMFYUI_URL}/api/history/{prompt_id}") as resp2:
                                h = await resp2.json()
                                entry = h.get(prompt_id)
                                if entry:
                                    return entry
                            logger.warning(f"[comfyui] Prompt {prompt_id} not in queue or history after {elapsed:.0f}s")
                except Exception:
                    pass

    raise TimeoutError(f"ComfyUI prompt {prompt_id} timed out after {timeout}s")


async def _download_output(session: aiohttp.ClientSession, filename: str, subfolder: str, output_dir: str) -> str:
    """Download a generated image from ComfyUI to output_dir."""
    params = {"filename": filename, "subfolder": subfolder, "type": "output"}
    async with session.get(f"{COMFYUI_URL}/api/view", params=params) as resp:
        resp.raise_for_status()
        os.makedirs(output_dir, exist_ok=True)
        out_path = os.path.join(output_dir, filename)
        with open(out_path, "wb") as f:
            f.write(await resp.read())
        logger.info(f"[comfyui] Downloaded output → {out_path}")
        return out_path


def _extract_output_images(history: dict) -> list[dict]:
    """Extract image info from history outputs."""
    images = []
    for node_id, node_out in history.get("outputs", {}).items():
        for img in node_out.get("images", []):
            images.append(img)
    return images


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def generate_image(prompt: str, output_dir: str = "/tmp/photo-magic") -> str:
    """Text-to-image generation (no input photo). Returns path to output image."""
    client_id = uuid.uuid4().hex
    workflow = _build_txt2img_workflow(prompt)

    async with aiohttp.ClientSession() as session:
        prompt_id = await _queue_prompt(session, workflow, client_id)

    history = await _wait_for_completion(prompt_id, client_id)
    images = _extract_output_images(history)
    if not images:
        raise RuntimeError(f"No output images for prompt {prompt_id}")

    img = images[0]
    async with aiohttp.ClientSession() as session:
        return await _download_output(session, img["filename"], img.get("subfolder", ""), output_dir)


async def edit_image(prompt: str, image_path: str, output_dir: str = "/tmp/photo-magic") -> str:
    """Edit a single image. Returns path to output image."""
    return await edit_multi_image(prompt, [image_path], output_dir)


async def edit_multi_image(prompt: str, image_paths: list[str], output_dir: str = "/tmp/photo-magic") -> str:
    """Multi-image composition (up to 3 images). Returns path to output image."""
    if not image_paths:
        raise ValueError("At least one image_path is required")
    if len(image_paths) > 3:
        raise ValueError("Maximum 3 images supported")

    client_id = uuid.uuid4().hex

    # Upload images
    async with aiohttp.ClientSession() as session:
        uploaded_names = []
        for p in image_paths:
            name = await _upload_image(session, p)
            uploaded_names.append(name)

    workflow = _build_edit_workflow(prompt, uploaded_names)

    async with aiohttp.ClientSession() as session:
        prompt_id = await _queue_prompt(session, workflow, client_id)

    history = await _wait_for_completion(prompt_id, client_id)
    images = _extract_output_images(history)
    if not images:
        raise RuntimeError(f"No output images for prompt {prompt_id}")

    img = images[0]
    async with aiohttp.ClientSession() as session:
        return await _download_output(session, img["filename"], img.get("subfolder", ""), output_dir)


async def inpaint_image(prompt: str, image_path: str, mask_path: str, output_dir: str = "/tmp/photo-magic") -> str:
    """Inpaint an image using a mask. White mask areas = edit, black = keep. Returns path to output image."""
    client_id = uuid.uuid4().hex

    async with aiohttp.ClientSession() as session:
        image_name = await _upload_image(session, image_path)
        mask_name = await _upload_image(session, mask_path)

    workflow = _build_edit_workflow(prompt, [image_name])

    # VAEEncodeForInpaint crashes with Qwen VAE (tuple downscale_ratio bug).
    # Instead: keep VAEEncode as-is, then apply mask via SetLatentNoiseMask.
    # This constrains noise to mask regions during sampling.

    # Add LoadImage node for the mask
    workflow["1450"] = {
        "class_type": "LoadImage",
        "inputs": {"image": mask_name},
    }

    # Convert IMAGE → MASK (use red channel)
    workflow["1451"] = {
        "class_type": "ImageToMask",
        "inputs": {
            "image": ["1450", 0],
            "channel": "red",
        },
    }

    # Insert SetLatentNoiseMask between VAEEncode (1423) and KSamplerAdvanced (1417)
    workflow["1452"] = {
        "class_type": "SetLatentNoiseMask",
        "inputs": {
            "samples": ["1423", 0],
            "mask": ["1451", 0],
        },
    }

    # Redirect KSampler's latent_image input from VAEEncode to SetLatentNoiseMask
    workflow["1417"]["inputs"]["latent_image"] = ["1452", 0]

    async with aiohttp.ClientSession() as session:
        prompt_id = await _queue_prompt(session, workflow, client_id)

    history = await _wait_for_completion(prompt_id, client_id)
    images = _extract_output_images(history)
    if not images:
        raise RuntimeError(f"No output images for prompt {prompt_id}")

    img = images[0]
    async with aiohttp.ClientSession() as session:
        return await _download_output(session, img["filename"], img.get("subfolder", ""), output_dir)


async def get_status(prompt_id: str) -> dict:
    """Check generation status for a prompt_id."""
    async with aiohttp.ClientSession() as session:
        async with session.get(f"{COMFYUI_URL}/api/history/{prompt_id}") as resp:
            if resp.status == 200:
                history = await resp.json()
                entry = history.get(prompt_id)
                if entry:
                    has_outputs = bool(_extract_output_images(entry))
                    return {"status": "completed" if has_outputs else "processing", "prompt_id": prompt_id}
            return {"status": "pending", "prompt_id": prompt_id}
