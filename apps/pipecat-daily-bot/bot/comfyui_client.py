"""ComfyUI async client for Photo Magic — Flux Kontext Dev (GGUF) image editing.

Uses native Kontext reference latent conditioning: each input image is
VAE-encoded separately and chained via ReferenceLatent nodes on the
positive conditioning.  No pixel-space stitching hacks.
"""

import os
import json
import uuid
import asyncio
import aiohttp
from pathlib import Path
from loguru import logger

COMFYUI_URL = os.getenv("COMFYUI_URL", "http://localhost:8188")
COMFYUI_OUTPUT_DIR = "/workspace/runpod-slim/ComfyUI/output"

# Flux Kontext Dev — split model loading
UNET_GGUF = "flux1-kontext-dev-Q5_k-marduk191.gguf"
CLIP_T5 = "t5xxl_fp8_e4m3fn.safetensors"
CLIP_L = "clip_l.safetensors"
VAE_NAME = "ae.safetensors"


# ---------------------------------------------------------------------------
# Shared model-loader nodes (reused across workflows)
# ---------------------------------------------------------------------------

def _model_loader_nodes() -> dict:
    """UnetLoaderGGUF + DualCLIPLoader + VAELoader."""
    return {
        "10": {
            "class_type": "UnetLoaderGGUF",
            "inputs": {"unet_name": UNET_GGUF},
        },
        "11": {
            "class_type": "DualCLIPLoader",
            "inputs": {
                "clip_name1": CLIP_T5,
                "clip_name2": CLIP_L,
                "type": "flux",
            },
        },
        "12": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": VAE_NAME},
        },
    }


def _conditioning_nodes(prompt: str) -> dict:
    """Positive + negative CLIP text encode."""
    return {
        "30": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": prompt, "clip": ["11", 0]},
        },
        "31": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "", "clip": ["11", 0]},
        },
    }


def _sampler_decode_save(positive_ref: list, latent_ref: list, denoise: float = 1.0) -> dict:
    """KSampler → VAEDecode → SaveImage."""
    return {
        "50": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["10", 0],
                "positive": positive_ref,
                "negative": ["31", 0],
                "latent_image": latent_ref,
                "seed": _rand_seed(),
                "steps": 28,
                "cfg": 1.0,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": denoise,
            },
        },
        "60": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["50", 0], "vae": ["12", 0]},
        },
        "70": {
            "class_type": "SaveImage",
            "inputs": {"images": ["60", 0], "filename_prefix": "ComfyUI"},
        },
    }


# ---------------------------------------------------------------------------
# Workflow builders
# ---------------------------------------------------------------------------

def _build_txt2img_workflow(prompt: str, width: int = 1024, height: int = 1024) -> dict:
    """Text-to-image: EmptyLatentImage → KSampler → VAEDecode → SaveImage."""
    wf = {}
    wf.update(_model_loader_nodes())
    wf.update(_conditioning_nodes(prompt))
    wf["40"] = {
        "class_type": "EmptyLatentImage",
        "inputs": {"width": width, "height": height, "batch_size": 1},
    }
    wf.update(_sampler_decode_save(["30", 0], ["40", 0]))
    return wf


def _build_edit_workflow(prompt: str, image_names: list[str]) -> dict:
    """Image edit via Flux Kontext native reference latent conditioning.

    Each input image is:
      1. Loaded via LoadImage
      2. Scaled via FluxKontextImageScale (optimal Kontext resolution)
      3. VAE-encoded to latent
      4. Chained onto positive conditioning via ReferenceLatent

    The output latent is an EmptyLatentImage at the first image's Kontext-scaled
    resolution.  KSampler denoises fully (denoise=1.0) conditioned by the
    reference latents and the text prompt.
    """
    wf = {}
    wf.update(_model_loader_nodes())
    wf.update(_conditioning_nodes(prompt))

    # For each input image: LoadImage → FluxKontextImageScale → VAEEncode
    # Then chain ReferenceLatent nodes on positive conditioning
    prev_cond_ref = ["30", 0]  # Start with base positive conditioning

    for i, name in enumerate(image_names[:3]):
        load_nid = str(20 + i * 3)       # 20, 23, 26
        scale_nid = str(20 + i * 3 + 1)  # 21, 24, 27
        vae_nid = str(20 + i * 3 + 2)    # 22, 25, 28
        ref_nid = str(35 + i)            # 35, 36, 37

        wf[load_nid] = {
            "class_type": "LoadImage",
            "inputs": {"image": name},
        }
        wf[scale_nid] = {
            "class_type": "FluxKontextImageScale",
            "inputs": {"image": [load_nid, 0]},
        }
        wf[vae_nid] = {
            "class_type": "VAEEncode",
            "inputs": {"pixels": [scale_nid, 0], "vae": ["12", 0]},
        }
        wf[ref_nid] = {
            "class_type": "ReferenceLatent",
            "inputs": {
                "conditioning": prev_cond_ref,
                "latent": [vae_nid, 0],
            },
        }
        prev_cond_ref = [ref_nid, 0]

    # Output latent: empty at 1024x1024 (Kontext generates the edited output)
    wf["40"] = {
        "class_type": "EmptyLatentImage",
        "inputs": {"width": 1024, "height": 1024, "batch_size": 1},
    }

    wf.update(_sampler_decode_save(prev_cond_ref, ["40", 0]))
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
    """Wait for prompt completion by polling history endpoint."""
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

            if elapsed % 30 < poll_interval:
                try:
                    async with session.get(f"{COMFYUI_URL}/api/queue") as resp:
                        q = await resp.json()
                        running_ids = [x[1] for x in q.get("queue_running", [])]
                        pending_ids = [x[1] for x in q.get("queue_pending", [])]
                        if prompt_id not in running_ids and prompt_id not in pending_ids:
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
# Public API (unchanged signatures)
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
    """Multi-image editing (up to 3 images). Returns path to output image."""
    if not image_paths:
        raise ValueError("At least one image_path is required")
    if len(image_paths) > 3:
        raise ValueError("Maximum 3 images supported")

    client_id = uuid.uuid4().hex

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
    """Inpaint an image using a mask. White = edit, black = keep."""
    client_id = uuid.uuid4().hex

    async with aiohttp.ClientSession() as session:
        image_name = await _upload_image(session, image_path)
        mask_name = await _upload_image(session, mask_path)

    workflow = _build_edit_workflow(prompt, [image_name])

    # Add mask via SetLatentNoiseMask on the output latent
    workflow["80"] = {
        "class_type": "LoadImage",
        "inputs": {"image": mask_name},
    }
    workflow["81"] = {
        "class_type": "ImageToMask",
        "inputs": {"image": ["80", 0], "channel": "red"},
    }
    workflow["82"] = {
        "class_type": "SetLatentNoiseMask",
        "inputs": {"samples": ["40", 0], "mask": ["81", 0]},
    }
    workflow["50"]["inputs"]["latent_image"] = ["82", 0]

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
