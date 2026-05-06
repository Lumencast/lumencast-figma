import json

src = json.load(open('tmp/unzip/_debug/raw-figma.json', encoding='utf-8'))

mcp_imported = """
46:875 TEMPLATE_STATS frame 0 0 1920 1080
46:876 Group_2087326246 frame 0 0 1920 1440
46:877 Rectangle_5 rounded-rectangle 0 0 1920 1440
46:878 image_3 rounded-rectangle 0 0 1920 1440
46:879 Frame_7 frame 1448 86 407.13 100
46:880 Group_2087326235 frame 0 33.78 229.13 32.43
46:881 PICTO_FINAL_2 frame 0 0 45.83 26.09
46:882 Calque_1-2 frame 0.70 -0.002 44.06 26.07
46:883 Union frame 0 0 44.06 26.07
46:887 LOGO_TXT_1 frame 50.76 0 178.37 32.43
46:888 Calque_1-2_TXT frame 0 0 178.34 32.46
46:899 logo-full-desktop-dark_1 frame 260.13 29.5 147 41
46:900 Calque_1-2_DARK frame 0 0 146.99 41
46:912 Rectangle_6 rounded-rectangle 66 237 1789 785
46:913 Mask_group_BOTTOM frame 0 837.15 1924.5 271.77
46:914 Vector_1 vector 0 -0.000001585 1924.5 271.77
46:915 Ruby20 rounded-rectangle 1842.27 589.24 2186.91 1265.38
46:916 Background_Shadow rounded-rectangle 83 234.84 94 8
46:917 Sunshine_27 rounded-rectangle 2501 1384 1463 1509
46:918 Group_2087326238 frame 2199.09 1393.24 770.10 770.10
46:919 Mask_group_RIGHT frame 0 0 830.18 830.18
46:920 3d-render_2 rounded-rectangle 0 0 881.53 881.53
46:921 Ellipse_1 ellipse 103.86 100.89 1086.84 1086.84
46:922 3d-render_1 rounded-rectangle 0 0 881.53 881.53
46:923 Sunshine_26 rounded-rectangle 908 1530 1463 1509
46:924 Unique_Logo vector 254.72 197.37 122.28 190.67
46:925 pqbORWP_1 rounded-rectangle 70 949 118 118
46:926 Frame_8 frame 69 33 100 116
46:927 On_demand text 0 0 1425 116
46:928 Group_2087326259 frame 1126 276 437.13 93
46:929 Rectangle_240648598 rounded-rectangle 0 0 272 93
46:930 Ellipse_43517 ellipse 7.07 65.87 18.57 17.81
46:931 Transform text 48 16 195 49
"""

imported = []
for line in mcp_imported.strip().split('\n'):
    parts = line.split(None, 5)
    if len(parts) < 6:
        continue
    w, h = parts[5].split()
    imported.append({
        'id': parts[0], 'name': parts[1], 'type': parts[2],
        'x': float(parts[3]), 'y': float(parts[4]),
        'w': float(w), 'h': float(h),
    })

def flatten(n, depth=0):
    yield {
        'id': n['id'], 'name': n['name'], 'type': n['type'],
        'x': n.get('x', 0), 'y': n.get('y', 0),
        'w': n.get('width', 0), 'h': n.get('height', 0),
        'visible': n.get('visible', True),
        'rotation': n.get('rotation'), 'depth': depth,
    }
    for c in n.get('children', []) or []:
        yield from flatten(c, depth + 1)

src_nodes = list(flatten(src))
hidden = sum(1 for n in src_nodes if n['visible'] is False)
print(f'Source: {len(src_nodes)} nodes ({hidden} hidden)')
print(f'Imported (visible only): {len(imported)} nodes')
print(f'Diff: {len(src_nodes) - len(imported)} nodes')
print()

# Group by depth + display order to map 1:1 ignoring node type lossy renames
print('=== Source tree (visible only) ===')
for n in src_nodes:
    if not n['visible']:
        continue
    indent = '  ' * n['depth']
    rot = f' rot={n["rotation"]:.1f}' if n['rotation'] else ''
    print(f'{indent}[{n["id"]:6}] {n["type"]:18} {n["name"][:35]:35} ({n["x"]:8.1f},{n["y"]:8.1f}) {n["w"]:7.1f}x{n["h"]:7.1f}{rot}')
