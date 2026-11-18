# Headless Blender: import the built GLB into an empty scene and render front + back with one color per group.
import bpy, sys, math, colorsys
glb, out_prefix = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
names = sorted(o.name for o in objs)
for o in objs:
    mat = bpy.data.materials.new(o.name)
    if o.name == 'body':
        mat.diffuse_color = (0.55, 0.55, 0.58, 1)
    else:
        h = names.index(o.name) / len(names)
        mat.diffuse_color = (*colorsys.hsv_to_rgb(h, 0.85, 0.95), 1)
    o.data.materials.clear(); o.data.materials.append(mat)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.color_type = 'MATERIAL'
sc.display.shading.light = 'STUDIO'
sc.render.resolution_x, sc.render.resolution_y = 600, 1000
# frame the body: bounds over all vertices (world space; glTF import is Y-up -> Blender Z-up)
xs, ys, zs = [], [], []
for o in objs:
    for v in o.data.vertices:
        w = o.matrix_world @ v.co; xs.append(w.x); ys.append(w.y); zs.append(w.z)
cx, cy, cz = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2
height = max(zs) - min(zs)
cam_data = bpy.data.cameras.new('cam'); cam_data.type = 'ORTHO'; cam_data.ortho_scale = height * 1.05
cam = bpy.data.objects.new('cam', cam_data); sc.collection.objects.link(cam); sc.camera = cam
print('bounds', round(min(xs),3), round(max(xs),3), round(min(ys),3), round(max(ys),3), round(min(zs),3), round(max(zs),3))
for label, y, rot in (('front', cy - 5, 0), ('back', cy + 5, math.pi)):
    cam.location = (cx, y, cz); cam.rotation_euler = (math.pi / 2, 0, rot)
    sc.render.filepath = f'{out_prefix}-{label}.png'
    bpy.ops.render.render(write_still=True)
