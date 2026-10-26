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
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lighting import add_lamps, add_stand_in_lights, expose_like_a_phone, light_outside  # noqa: E402
from own_models import use_own_models  # noqa: E402
from render_args import JobError, look_at_euler, parse_job, studio_to_blender  # noqa: E402
from surfaces import finish_surfaces, soften_edges  # noqa: E402


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


def ready_to_explore(scene: bpy.types.Scene) -> None:
    """Open the saved file looking the way the render does, from where it was taken: the view
    shows Blender's own renderer live (grainy for a moment while moving, then clean), and it
    turns and zooms around the room in front of the camera, not the corner where the home's
    plan starts. Ceilings are only in the file when the camera is inside a room; hide one
    (click it, press H) to look in from above.

    The home's plan starts at a corner, and Blender turns around its world's middle (and puts
    its 3D cursor there) whenever it has nothing better, so everything, camera and lights
    included, is moved to put the middle of the home's floor there. The picture is the same;
    the file's numbers are the studio's moved by `fullscale_offset`."""
    scene.cycles.preview_samples = 64
    scene.cycles.use_preview_denoising = True
    scene.cycles.preview_denoising_start_sample = 1
    corners = [obj.matrix_world @ Vector(c) for obj in scene.objects if obj.type == "MESH" for c in obj.bound_box]
    camera = scene.camera
    if not corners or camera is None:
        return
    low = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    high = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    offset = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, 0.0))
    for obj in scene.objects:
        if obj.parent is None:
            obj.location -= offset
    scene["fullscale_offset"] = tuple(-offset)
    scene.cursor.location = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    low -= offset
    high -= offset
    eye = camera.matrix_world.translation
    forward = camera.matrix_world.to_3x3() @ Vector((0.0, 0.0, -1.0))
    reach = max(1.0, ((low + high) / 2 - eye).length)
    for screen in bpy.data.screens:
        for area in screen.areas:
            for space in area.spaces:
                if space.type != "VIEW_3D":
                    continue
                space.shading.type = "RENDERED"
                space.lens = camera.data.lens
                space.clip_start = 0.01
                view = space.region_3d
                if view is not None:
                    # Blender's view sits `view_distance` behind the point it turns around.
                    view.view_perspective = "PERSP"
                    view.view_rotation = camera.matrix_world.to_quaternion()
                    view.view_location = eye + forward * reach
                    view.view_distance = reach


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
    # Rooms are lit mostly by light bouncing off walls and ceilings, so let it bounce.
    scene.cycles.max_bounces = 12
    scene.cycles.diffuse_bounces = 6
    scene.cycles.glossy_bounces = 4
    scene.cycles.transmission_bounces = 8
    scene.cycles.blur_glossy = 1.0
    # In the picture's brightness; the exposure step scales it to the scene.
    scene.cycles.sample_clamp_indirect = 10.0
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.cycles.seed = 1
    try:
        scene.view_settings.view_transform = "AgX"
        # AgX on its own washes out strong colours (a red bedsheet turns pink); its punchy
        # look keeps them as a phone photo shows them.
        scene.view_settings.look = "AgX - Punchy"
    except TypeError:
        scene.view_settings.view_transform = "Filmic"
    scene.render.resolution_x = job.preset.width
    scene.render.resolution_y = job.preset.height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = job.out
    own = use_own_models(scene, job.models) if job.models else {}
    surfaces = finish_surfaces(job.files)
    softened = soften_edges(scene)
    report("FULLSCALE_PROGRESS", {"step": "surfaces", "materials": surfaces, "softenedMeshes": softened, **own})
    lighting = job.lighting
    lamps = add_lamps(scene)
    # After dark, a room needs a light; when the home has none, an ordinary ceiling light
    # stands in, and the result says so.
    stand_ins = add_stand_in_lights(scene) if not lamps and lighting.time != "day" else 0
    outside = light_outside(scene, lighting)
    report("FULLSCALE_PROGRESS", {"step": "lighting", "time": lighting.time, "lamps": len(lamps), "standInLights": stand_ins, **outside})

    camera_data = bpy.data.cameras.new("Camera")
    camera_data.sensor_fit = "VERTICAL"
    camera_data.angle_y = math.radians(job.fov)
    camera = bpy.data.objects.new("Camera", camera_data)
    eye = studio_to_blender(job.eye)
    camera.location = eye
    camera.rotation_euler = look_at_euler(eye, studio_to_blender(job.target))
    scene.collection.objects.link(camera)
    scene.camera = camera

    report("FULLSCALE_PROGRESS", {"step": "metering"})
    exposure = expose_like_a_phone(scene, lighting, lamps)
    if job.blend:
        # The scene as rendered, to open in Blender and look around in or change.
        ready_to_explore(scene)
        bpy.ops.wm.save_as_mainfile(filepath=job.blend, copy=True)
        report("FULLSCALE_PROGRESS", {"step": "saved", "blend": job.blend})
    report("FULLSCALE_PROGRESS", {"step": "rendering", "device": device, "samples": job.preset.samples})
    bpy.ops.render.render(write_still=True)
    report(
        "FULLSCALE_RESULT",
        {
            "out": job.out,
            "width": job.preset.width,
            "height": job.preset.height,
            "device": device,
            "samples": job.preset.samples,
            "seconds": round(time.monotonic() - started, 1),
            "blender": bpy.app.version_string,
            "lighting": {"time": lighting.time, "lamps": len(lamps), "standInLights": stand_ins, **outside, **exposure},
            **own,
            **({"blend": job.blend} if job.blend else {}),
        },
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
