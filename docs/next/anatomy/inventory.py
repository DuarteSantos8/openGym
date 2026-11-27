# Headless Blender: inventory of the Z-Anatomy template, muscles first.
import bpy, sys
out = open(sys.argv[sys.argv.index('--') + 1], 'w', encoding='utf-8')
def p(*a): print(*a, file=out)
p('blend:', bpy.data.filepath)
p('objects:', len(bpy.data.objects), 'meshes:', len([o for o in bpy.data.objects if o.type == 'MESH']))
def tree(c, d=0):
    meshes = [o for o in c.objects if o.type == 'MESH']
    polys = sum(len(o.data.polygons) for o in meshes)
    p('  ' * d + f'[{c.name}] meshes={len(meshes)} polys={polys}')
    if d < 3:
        for ch in c.children: tree(ch, d + 1)
for c in bpy.data.scenes[0].collection.children: tree(c)
mus = [o for o in bpy.data.objects if o.type == 'MESH' and any('muscul' in col.name.lower() or 'muscle' in col.name.lower() for col in o.users_collection)]
p('muscle-collection meshes:', len(mus), 'polys:', sum(len(o.data.polygons) for o in mus))
for o in sorted(mus, key=lambda o: o.name)[:400]:
    p('M', o.name, len(o.data.polygons), [c.name for c in o.users_collection][:2])
out.close()
