# Headless Blender: Z-Anatomy muscles -> one simplified GLB with one mesh per openGym muscle group.
# usage: blender --background --factory-startup Startup.blend --python build_muscles.py -- out.glb report.json
import bpy, re, sys, json
out_glb, report_path = sys.argv[sys.argv.index('--') + 1:][:2]

# openGym's muscle ids (frontend/src/lib/muscles.js MUSCLES) -> Z-Anatomy (Terminologia Anatomica) names.
RULES = [
    ('trapezius',   r'trapezius'),
    ('front-delts', r'clavicular part of deltoid'),
    ('side-delts',  r'acromial part of deltoid'),
    ('rear-delts',  r'spinal part of deltoid'),
    ('chest',       r'pectoralis major'),
    ('lats',        r'latissimus dorsi'),
    ('upper-back',  r'rhomboid|teres major|teres minor|infraspinatus'),
    ('serratus',    r'serratus anterior'),
    ('biceps',      r'biceps brachii|\bbrachialis\b'),
    ('triceps',     r'triceps brachii|anconeus'),
    ('forearm',     r'brachioradialis|flexor carpi|extensor carpi|flexor digitorum (superficialis|profundus)|extensor digitorum|palmaris longus|pronator teres|supinator'),
    ('abs',         r'rectus abdominis'),
    ('obliques',    r'abdominal oblique'),
    ('lower-back',  r'erector spinae|iliocostalis|longissimus thoracis|spinalis thoracis|multifid|quadratus lumborum'),
    ('gluteal',     r'gluteus (maximus|medius|minimus)'),
    ('quadriceps',  r'rectus femoris|vastus'),
    ('hamstring',   r'biceps femoris|semitendinosus|semimembranosus'),
    ('adductors',   r'adductor (longus|brevis|magnus)|gracilis|pectineus'),
    ('hip-flexors', r'iliacus|psoas|sartorius|tensor fasciae latae'),
    ('calves',      r'gastrocnemius|soleus'),
    ('tibialis',    r'tibialis anterior'),
]
SKIP = re.compile(r'fascia|tendon|aponeuros|sheath|retinacul|ligament|bursa|laryn|ocul|auric|tympan|palat|lingu|pharyn|tars|ossicl', re.I)
GROUP_FACES = 3500     # budget per muscle group
BODY_FACES = 22000     # everything unmapped, for the silhouette

col = bpy.data.collections['4: Muscular system']
cands = [o for o in col.all_objects if o.type == 'MESH' and len(o.data.polygons) > 0 and re.search(r'\.(l|r)$', o.name)]
groups, rule_hits = {}, {g: 0 for g, _ in RULES}
for o in cands:
    base = o.name[:-2].lower()
    if SKIP.search(base):
        continue
    g = next((gid for gid, rx in RULES if re.search(rx, base)), 'body')
    if g != 'body': rule_hits[g] += 1
    groups.setdefault(g, []).append(o)

scene = bpy.context.scene
outcol = bpy.data.collections.new('opengym-export'); scene.collection.children.link(outcol)
report = {'source': 'Z-Anatomy Startup.blend', 'groups': {}}
for g, objs in groups.items():
    src = sum(len(o.data.polygons) for o in objs)
    ratio = min(1.0, (BODY_FACES if g == 'body' else GROUP_FACES) / max(1, src))
    for o in objs:
        m = o.modifiers.new('og_dec', 'DECIMATE'); m.ratio = ratio
    dg = bpy.context.evaluated_depsgraph_get()
    verts, faces = [], []
    for o in objs:
        ev = o.evaluated_get(dg); me = ev.to_mesh(); M = o.matrix_world
        off = len(verts)
        verts.extend([tuple(M @ v.co) for v in me.vertices])
        faces.extend([[off + i for i in p.vertices] for p in me.polygons])
        ev.to_mesh_clear()
    mesh = bpy.data.meshes.new(g); mesh.from_pydata(verts, [], faces); mesh.validate(); mesh.update()
    for p in mesh.polygons: p.use_smooth = True
    ob = bpy.data.objects.new(g, mesh); outcol.objects.link(ob)
    report['groups'][g] = {'objects': len(objs), 'sourceFaces': src, 'faces': len(mesh.polygons), 'ratio': round(ratio, 4)}

bpy.ops.object.select_all(action='DESELECT')
for ob in outcol.objects: ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', use_selection=True, export_yup=True,
    export_apply=False, export_materials='NONE', export_normals=True, export_texcoords=False,
    export_copyright='Z-Anatomy (CC BY-SA 4.0) and BodyParts3D, The Database Center for Life Science (CC BY-SA 2.1 Japan); simplified for openGym Next')
report['ruleHits'] = rule_hits
report['missing'] = [g for g, n in rule_hits.items() if n == 0]
report['totalFaces'] = sum(v['faces'] for v in report['groups'].values())
json.dump(report, open(report_path, 'w'), indent=1)
