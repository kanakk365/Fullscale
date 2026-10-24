# SPDX-License-Identifier: GPL-3.0-or-later
# A photo-real picture of a home, rendered by Blender without its window:
#
#   blender -b --factory-startup --python blender/render/render.py -- --glb … --out … --camera … --preset …
#
# The studio runs this and reads stdout from the end: progress lines start with
# FULLSCALE_PROGRESS, and the last line is FULLSCALE_RESULT or FULLSCALE_ERROR, each followed
# by JSON. Blender starts from factory settings and the file is thrown away, so nothing
# needs restoring afterwards.
from __future__ import annotations

import json
import math
import os
import sys
import time
import traceback

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render_args import JobError, look_at_euler, parse_job, studio_to_blender  # noqa: E402


def report(marker: str, payload: dict) -> None:
    print(f"{marker} {json.dumps(payload)}", flush=True)


def use_gpu(scene: bpy.types.Scene) -> str:
    """Render on the GPU when Blender finds one (Metal on Macs), else the CPU."""
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for kind in ("METAL", "OPTIX", "CUDA", "HIP", "ONEAPI"):
            try:
                prefs.compute_device_type = kind
            except TypeError:
                continue
            prefs.get_devices()
            devices = [d for d in prefs.devices if d.type == kind]
            if devices:
                for d in devices:
                    d.use = True
                scene.cycles.device = "GPU"
                return f"GPU ({kind}: {', '.join(d.name for d in devices)})"
    except (KeyError, AttributeError):
        pass
    scene.cycles.device = "CPU"
    return "CPU"


def set_up_world(scene: bpy.types.Scene) -> None:
    world = bpy.data.worlds.new("Fullscale sky")
    scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    background = next(n for n in nodes if n.type == "BACKGROUND")
    try:
        sky = nodes.new("ShaderNodeTexSky")
        world.node_tree.links.new(sky.outputs["Color"], background.inputs["Color"])
        background.inputs["Strength"].default_value = 0.6
    except RuntimeError:
        # No sky texture in this Blender: a soft plain light instead.
        background.inputs["Color"].default_value = (0.85, 0.88, 0.92, 1.0)
        background.inputs["Strength"].default_value = 0.8
    sun_data = bpy.data.lights.new("Sun", type="SUN")
    sun_data.energy = 3.0
    sun_data.angle = 0.05
    sun = bpy.data.objects.new("Sun", sun_data)
    sun.rotation_euler = (0.9, 0.2, 0.8)
    scene.collection.objects.link(sun)


def main() -> None:
    started = time.monotonic()
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    job = parse_job(argv)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    report("FULLSCALE_PROGRESS", {"step": "importing"})
    bpy.ops.import_scene.gltf(filepath=job.glb)

    scene.render.engine = "CYCLES"
    device = use_gpu(scene)
    scene.cycles.samples = job.preset.samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = job.preset.noise_threshold
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 8
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 4
    scene.cycles.sample_clamp_indirect = 10.0
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.cycles.seed = 1
    try:
        scene.view_settings.view_transform = "AgX"
    except TypeError:
        scene.view_settings.view_transform = "Filmic"
    scene.render.resolution_x = job.preset.width
    scene.render.resolution_y = job.preset.height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = job.out
    set_up_world(scene)

    camera_data = bpy.data.cameras.new("Camera")
    camera_data.sensor_fit = "VERTICAL"
    camera_data.angle_y = math.radians(job.fov)
    camera = bpy.data.objects.new("Camera", camera_data)
    eye = studio_to_blender(job.eye)
    camera.location = eye
    camera.rotation_euler = look_at_euler(eye, studio_to_blender(job.target))
    scene.collection.objects.link(camera)
    scene.camera = camera

    report("FULLSCALE_PROGRESS", {"step": "rendering", "device": device, "samples": job.preset.samples})
    bpy.ops.render.render(write_still=True)
    report(
        "FULLSCALE_RESULT",
        {"out": job.out, "width": job.preset.width, "height": job.preset.height, "device": device, "samples": job.preset.samples, "seconds": round(time.monotonic() - started, 1), "blender": bpy.app.version_string},
    )


if __name__ == "__main__":
    try:
        main()
    except JobError as error:
        report("FULLSCALE_ERROR", {"error": str(error)})
        sys.exit(1)
    except Exception as error:  # Anything else: say so on the line the studio reads.
        traceback.print_exc()
        report("FULLSCALE_ERROR", {"error": f"{type(error).__name__}: {error}"})
        sys.exit(1)
