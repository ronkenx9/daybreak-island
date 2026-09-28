# Daybreak chibi character, built and rigged headlessly in Blender.
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/blender/chibi.py -- <out.glb> [preview.png]
# Low-poly, rigidly bone-parented parts (cheap to render), named materials so
# the game can recolour looks, and six actions exported as glTF animations.
import bpy, bmesh, math, sys, os
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/tmp/chibi.glb'
PREVIEW = argv[1] if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 24

# ---------------------------------------------------------------- materials
def mat(name, color, rough=0.6, metal=0.0, emit=None, emit_strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit is not None:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = emit_strength
    return m

def srgb(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)

M = {
    'Skin': mat('Skin', srgb('#14151f'), rough=0.22),
    'Hat': mat('Hat', srgb('#2b4dff'), rough=0.95),
    'Flap': mat('Flap', srgb('#f4f6fb'), rough=0.95),
    'Jacket': mat('Jacket', srgb('#f4f6fb'), rough=0.55),
    'Seam': mat('Seam', srgb('#c9cfdc'), rough=0.6),
    'Pants': mat('Pants', srgb('#1b2a7a'), rough=0.8),
    'Shoes': mat('Shoes', srgb('#2b4dff'), rough=0.35),
    'Glove': mat('Glove', srgb('#f6f7fb'), rough=0.4),
    'Chrome': mat('Chrome', srgb('#eef2f8'), rough=0.12, metal=1.0),
    'EyeWhite': mat('EyeWhite', srgb('#ffffff'), rough=0.3),
    'Pupil': mat('Pupil', srgb('#0b0b10'), rough=0.2),
    'Pin': mat('Pin', srgb('#ffffff'), rough=0.3, metal=0.2),
    'PinMark': mat('PinMark', srgb('#e3303a'), rough=0.3),
    'Wood': mat('Wood', srgb('#8a5a33'), rough=0.8),
    'Steel': mat('Steel', srgb('#c9d2dc'), rough=0.3, metal=0.8),
}

# glowing cell cracks on the head: voronoi edges painted into an emission map (numpy)
def crack_image(size=512):
    rng = np.random.default_rng(7)
    u = rng.uniform(-1, 1, 44); th = rng.uniform(0, 2 * np.pi, 44); q = np.sqrt(1 - u * u)
    P = np.stack([q * np.cos(th), u, q * np.sin(th)], 1)
    H, W = size // 2, size
    lat = (np.arange(H) + 0.5) / H * np.pi; lon = (np.arange(W) + 0.5) / W * 2 * np.pi
    sy = np.cos(lat)[:, None].repeat(W, 1); sr = np.sin(lat)[:, None]
    X = sr * np.cos(lon)[None, :]; Z = sr * np.sin(lon)[None, :]
    pts = np.stack([X, sy, Z], -1).reshape(-1, 3)
    d = np.sqrt(((pts[:, None, :] - P[None, :, :]) ** 2).sum(-1))
    d.sort(1)
    edge = (d[:, 1] - d[:, 0]).reshape(H, W)
    w = np.clip(1 - edge / 0.02, 0, 1) ** 2 + np.clip(1 - edge / 0.07, 0, 1) ** 3 * 0.3
    img = bpy.data.images.new('Cracks', W, H)
    px = np.zeros((H, W, 4), np.float32)
    px[..., 0] = 0.35 * w; px[..., 1] = 0.7 * w; px[..., 2] = 1.0 * w; px[..., 3] = 1
    img.pixels.foreach_set(px[::-1].ravel())
    img.pack()
    return img

skin = M['Skin']
bsdf = next(n for n in skin.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
tex = skin.node_tree.nodes.new('ShaderNodeTexImage')
tex.image = crack_image()
skin.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Emission Color'])
bsdf.inputs['Emission Strength'].default_value = 1.6

# ---------------------------------------------------------------- mesh helpers
def finish(obj, material, smooth=True):
    obj.data.materials.append(material)
    if smooth:
        for p in obj.data.polygons: p.use_smooth = True
    return obj

def sphere(name, loc, scale, material, seg=18, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, location=loc)
    o = bpy.context.active_object; o.name = name; o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    return finish(o, material)

def cyl(name, loc, r, depth, material, rot=(0, 0, 0), verts=14, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object; o.name = name
    if bevel:
        mod = o.modifiers.new('bevel', 'BEVEL'); mod.width = bevel; mod.segments = 3
        bpy.ops.object.modifier_apply(modifier='bevel')
    return finish(o, material)

def torus(name, loc, major, minor, material, rot=(0, 0, 0), scale=(1, 1, 1), seg=24, mseg=10):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=seg, minor_segments=mseg, location=loc, rotation=rot)
    o = bpy.context.active_object; o.name = name; o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    return finish(o, material)

def capsule(name, a, b, r, material):
    a, b = Vector(a), Vector(b)
    mid = (a + b) / 2; d = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=r, depth=d.length, location=mid)
    o = bpy.context.active_object; o.name = name
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    mod = o.modifiers.new('bevel', 'BEVEL'); mod.width = r * 0.9; mod.segments = 4; mod.limit_method = 'NONE'
    bpy.ops.object.modifier_apply(modifier='bevel')
    return finish(o, material)

def fluffy(o, strength=0.035, size=0.08, subdiv=1):
    # plush look without fur shells: subdivide + lumpy displacement
    if subdiv:
        s = o.modifiers.new('sub', 'SUBSURF'); s.levels = subdiv; bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier='sub')
    t = bpy.data.textures.new(o.name + 'Tex', 'CLOUDS'); t.noise_scale = size; t.noise_depth = 1
    d = o.modifiers.new('disp', 'DISPLACE'); d.texture = t; d.strength = strength; d.mid_level = 0.5
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier='disp')
    return o

# ---------------------------------------------------------------- the character (facing -Y, Z up)
HEAD_Z = 1.62
parts = {}
# legs + boots
for s, side in ((-1, 'L'), (1, 'R')):
    parts[f'leg_{side}'] = [capsule(f'Leg_{side}', (s * 0.15, 0, 0.46), (s * 0.15, 0, 0.17), 0.1, M['Pants']),
                            sphere(f'Boot_{side}', (s * 0.16, -0.04, 0.09), (0.15, 0.22, 0.1), M['Shoes'])]
# torso: puffer jacket, seams, zip, fur collar
torso = sphere('Torso', (0, 0, 0.74), (0.37, 0.33, 0.4), M['Jacket'], seg=20, rings=14)
seams = [torus(f'Seam{i}', (0, 0, z), 0.355 - abs(z - 0.74) * 0.25, 0.022, M['Seam'], scale=(1, 0.9, 1)) for i, z in enumerate((0.62, 0.86))]
zipper = cyl('Zip', (0, -0.33, 0.76), 0.012, 0.42, M['Chrome'], verts=6)
collar = fluffy(torus('Collar', (0, 0, 1.08), 0.27, 0.11, M['Flap']), 0.03)
parts['spine'] = [torso, *seams, zipper, collar]
# arms + mittens
for s, side in ((-1, 'L'), (1, 'R')):
    parts[f'arm_{side}'] = [capsule(f'Arm_{side}', (s * 0.34, 0, 0.98), (s * 0.44, -0.02, 0.66), 0.09, M['Jacket']),
                            sphere(f'Mitt_{side}', (s * 0.46, -0.03, 0.6), (0.13, 0.12, 0.13), M['Glove'])]
# shovel in the right mitt (hidden unless digging)
shovel = [cyl('ShovelShaft', (0.46, -0.03, 0.72), 0.025, 0.9, M['Wood'], verts=6),
          cyl('ShovelBlade', (0.46, -0.03, 0.22), 0.12, 0.03, M['Steel'], rot=(math.pi / 2, 0, 0), verts=8)]
for o in shovel: o['shovel'] = 1
parts['arm_R'] += shovel
# head
head = sphere('Head', (0, 0, HEAD_Z), (0.62, 0.62, 0.62), M['Skin'], seg=28, rings=18)
face = []
for s in (-1, 1):
    face.append(sphere('EyeWhite', (s * 0.22, -0.5, HEAD_Z - 0.02), (0.19, 0.12, 0.17), M['EyeWhite']))
    face.append(sphere('Pupil', (s * 0.2, -0.6, HEAD_Z - 0.04), (0.085, 0.04, 0.095), M['Pupil']))
    face.append(sphere('Glint', (s * 0.17, -0.635, HEAD_Z + 0.0), (0.028, 0.012, 0.028), M['EyeWhite']))
    face.append(sphere('Lid', (s * 0.22, -0.53, HEAD_Z + 0.11), (0.2, 0.1, 0.075), M['Skin']))
    fr = torus('Frame', (s * 0.23, -0.64, HEAD_Z - 0.02), 0.2, 0.05, M['Chrome'], rot=(math.pi / 2, 0, 0), scale=(1.15, 1, 0.82), seg=20, mseg=8)
    face.append(fr)
    face.append(capsule('Temple', (s * 0.47, -0.56, HEAD_Z + 0.0), (s * 0.6, -0.1, HEAD_Z + 0.04), 0.03, M['Chrome']))
face.append(cyl('Bridge', (0, -0.67, HEAD_Z + 0.02), 0.03, 0.1, M['Chrome'], rot=(0, math.pi / 2, 0), verts=8))
mouth = torus('Mouth', (0, -0.57, HEAD_Z - 0.22), 0.11, 0.024, M['EyeWhite'], rot=(math.pi / 2, 0, 0), seg=24, mseg=6)
# keep only the lower arc of the ring: a smile, not an "o"
bpy.ops.object.transform_apply(rotation=True)
bm = bmesh.new(); bm.from_mesh(mouth.data)
cz = sum(v.co.z for v in bm.verts) / len(bm.verts)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > cz - 0.035], context='VERTS')
bm.to_mesh(mouth.data); bm.free()
face.append(mouth)
# ushanka: cushioned crown, thick band, fluffy earmuffs, pin
crown = fluffy(cyl('Crown', (0, 0, HEAD_Z + 0.62), 0.72, 0.46, M['Hat'], verts=24, bevel=0.15), 0.04)
band = fluffy(torus('Band', (0, 0, HEAD_Z + 0.42), 0.72, 0.13, M['Hat'], scale=(1, 1, 1.15), seg=28), 0.04)
muffs = [fluffy(sphere(f'Muff_{sd}', (s * 0.68, 0.02, HEAD_Z - 0.06), (0.15, 0.23, 0.25), M['Flap']), 0.03) for s, sd in ((-1, 'L'), (1, 'R'))]
pin = [cyl('Pin', (0.3, -0.8, HEAD_Z + 0.68), 0.12, 0.035, M['Pin'], rot=(math.pi / 2, 0, 0), verts=16),
       cyl('PinMark', (0.3, -0.823, HEAD_Z + 0.68), 0.07, 0.02, M['PinMark'], rot=(math.pi / 2, 0, 0), verts=12)]
parts['head'] = [head, *face, crown, band, *muffs, *pin]

# ---------------------------------------------------------------- rig
bpy.ops.object.armature_add(location=(0, 0, 0))
arm = bpy.context.active_object; arm.name = 'Rig'
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones
root = eb[0]; root.name = 'root'; root.head = (0, 0, 0); root.tail = (0, 0, 0.3)
def bone(name, head, tail, parent):
    b = eb.new(name); b.head = head; b.tail = tail; b.parent = eb[parent]; b.roll = 0
    return b
bone('hips', (0, 0, 0.5), (0, 0, 0.62), 'root')
bone('spine', (0, 0, 0.62), (0, 0, 1.05), 'hips')
bone('head', (0, 0, 1.08), (0, 0, 1.5), 'spine')
for s, side in ((-1, 'L'), (1, 'R')):
    bone(f'arm_{side}', (s * 0.34, 0, 0.98), (s * 0.46, -0.02, 0.6), 'spine')
    bone(f'leg_{side}', (s * 0.15, 0, 0.5), (s * 0.15, 0, 0.08), 'hips')
bpy.ops.object.mode_set(mode='OBJECT')

for bname, objs in parts.items():
    for o in objs:
        mw = o.matrix_world.copy()
        o.parent = arm; o.parent_type = 'BONE'; o.parent_bone = bname
        o.matrix_world = mw

# ---------------------------------------------------------------- animations
def action(name, frames, keys):
    """keys: {frame: {bone: (rx, ry, rz) degrees or ('loc', x, y, z)}}"""
    act = bpy.data.actions.new(name); act.use_fake_user = True
    arm.animation_data_create(); arm.animation_data.action = act
    for pb in arm.pose.bones: pb.rotation_mode = 'XYZ'
    for f, pose in sorted(keys.items()):
        for pb in arm.pose.bones: pb.rotation_euler = (0, 0, 0); pb.location = (0, 0, 0)
        for b, v in pose.items():
            pb = arm.pose.bones[b]
            if v[0] == 'loc': pb.location = v[1:]
            else: pb.rotation_euler = [math.radians(a) for a in v]
        for pb in arm.pose.bones:
            pb.keyframe_insert('rotation_euler', frame=f)
            pb.keyframe_insert('location', frame=f)
    act.frame_range = (1, frames)
    # push to an NLA track so the exporter keeps every action
    tr = arm.animation_data.nla_tracks.new(); tr.name = name
    tr.strips.new(name, 1, act)
    arm.animation_data.action = None
    return act

R = lambda x=0, y=0, z=0: (x, y, z)
action('idle', 48, {
    1: {'spine': R(0), 'head': R(0, 0, 0)},
    24: {'spine': R(3), 'head': R(-3, 0, 4), 'hips': ('loc', 0, 0.02, 0)},
    48: {'spine': R(0), 'head': R(0, 0, 0)},
})
# bones point along their length; +X rotation swings a down-pointing limb backward
action('walk', 16, {
    1: {'leg_L': R(32), 'leg_R': R(-32), 'arm_L': R(-30), 'arm_R': R(30), 'spine': R(6), 'hips': ('loc', 0, 0, 0)},
    5: {'leg_L': R(0), 'leg_R': R(0), 'arm_L': R(0), 'arm_R': R(0), 'spine': R(6), 'hips': ('loc', 0, 0.07, 0)},
    9: {'leg_L': R(-32), 'leg_R': R(32), 'arm_L': R(30), 'arm_R': R(-30), 'spine': R(6), 'hips': ('loc', 0, 0, 0)},
    13: {'leg_L': R(0), 'leg_R': R(0), 'arm_L': R(0), 'arm_R': R(0), 'spine': R(6), 'hips': ('loc', 0, 0.07, 0)},
    16: {'leg_L': R(32), 'leg_R': R(-32), 'arm_L': R(-30), 'arm_R': R(30), 'spine': R(6), 'hips': ('loc', 0, 0, 0)},
})
action('dig', 20, {
    1: {'spine': R(-10), 'arm_L': R(-80), 'arm_R': R(-85), 'head': R(8)},
    8: {'spine': R(30), 'arm_L': R(-20), 'arm_R': R(-15), 'head': R(-10), 'hips': ('loc', 0, -0.05, 0)},
    14: {'spine': R(22), 'arm_L': R(-30), 'arm_R': R(-25), 'head': R(-6)},
    20: {'spine': R(-10), 'arm_L': R(-80), 'arm_R': R(-85), 'head': R(8)},
})
action('cheer', 20, {
    1: {'hips': ('loc', 0, 0, 0), 'arm_L': R(0, 0, -150), 'arm_R': R(0, 0, 150), 'head': R(-10)},
    6: {'hips': ('loc', 0, 0.35, 0), 'arm_L': R(0, 0, -165), 'arm_R': R(0, 0, 165), 'leg_L': R(-20), 'leg_R': R(20), 'head': R(-15)},
    12: {'hips': ('loc', 0, 0.05, 0), 'arm_L': R(0, 0, -145), 'arm_R': R(0, 0, 145), 'head': R(-8)},
    20: {'hips': ('loc', 0, 0, 0), 'arm_L': R(0, 0, -150), 'arm_R': R(0, 0, 150), 'head': R(-10)},
})
action('wave', 20, {
    1: {'arm_R': R(0, 0, 150), 'head': R(0, 0, -6)},
    6: {'arm_R': R(0, 25, 150)},
    11: {'arm_R': R(0, -25, 150)},
    16: {'arm_R': R(0, 25, 150)},
    20: {'arm_R': R(0, 0, 150), 'head': R(0, 0, -6)},
})
action('sad', 24, {
    1: {'head': R(22), 'spine': R(12), 'arm_L': R(0, 0, 8), 'arm_R': R(0, 0, -8), 'hips': ('loc', 0, -0.04, 0)},
    24: {'head': R(26, 0, 6), 'spine': R(14), 'arm_L': R(0, 0, 8), 'arm_R': R(0, 0, -8), 'hips': ('loc', 0, -0.05, 0)},
})

# ---------------------------------------------------------------- preview render (optional)
if PREVIEW:
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    scene.render.resolution_x = 800; scene.render.resolution_y = 800
    world = bpy.data.worlds.new('W'); scene.world = world; world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.66, 0.84, 0.94, 1)
    bpy.ops.object.camera_add(location=(1.8, -4.8, 1.75)); cam = bpy.context.active_object
    cam.rotation_euler = (math.radians(89), 0, math.radians(20)); scene.camera = cam
    for o in scene.objects:
        if o.get('shovel'): o.hide_render = True
    bpy.ops.object.light_add(type='SUN', location=(3, -3, 6)); bpy.context.active_object.data.energy = 3.5
    bpy.context.active_object.rotation_euler = (math.radians(40), math.radians(10), math.radians(30))
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)

# ---------------------------------------------------------------- export
for o in list(scene.objects):
    if o.type in ('CAMERA', 'LIGHT'): bpy.data.objects.remove(o)
os.makedirs(os.path.dirname(OUT) or '.', exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_animations=True, export_animation_mode='NLA_TRACKS', export_apply=True, export_yup=True)
print('EXPORTED', OUT, os.path.getsize(OUT))
