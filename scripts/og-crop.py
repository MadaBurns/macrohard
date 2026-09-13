"""Crop a Chrome screenshot to the top-left WxH card and verify it is intact."""
import sys, zlib, struct

def read_png(path):
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG'
    i, idat, w, h, bd, ct = 8, b'', None, None, None, None
    while i < len(d):
        ln = struct.unpack('>I', d[i:i + 4])[0]
        typ = d[i + 4:i + 8]
        if typ == b'IHDR':
            w, h, bd, ct = struct.unpack('>IIBB', d[i + 8:i + 18])
        elif typ == b'IDAT':
            idat += d[i + 8:i + 8 + ln]
        elif typ == b'IEND':
            break
        i += 12 + ln
    assert bd == 8 and ct in (2, 6), f'unsupported PNG (bd={bd} ct={ct})'
    bpp = 3 if ct == 2 else 4
    raw, stride, out, prev, p = zlib.decompress(idat), w * bpp, [], bytearray(w * bpp), 0
    for _ in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        if f:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                if f == 1: line[x] = (line[x] + a) & 255
                elif f == 2: line[x] = (line[x] + b) & 255
                elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
                else:
                    pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                    line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        out.append(bytes(line)); prev = line
    return w, h, bpp, out

def write_png(path, w, h, rowsrgb):
    def chunk(t, data):
        return struct.pack('>I', len(data)) + t + data + struct.pack('>I', zlib.crc32(t + data) & 0xFFFFFFFF)
    body = b''.join(b'\x00' + r for r in rowsrgb)
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(body, 9))
           + chunk(b'IEND', b''))
    open(path, 'wb').write(png)

src, dst, W, H = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
w, h, bpp, rws = read_png(src)
assert w >= W and h >= H, f'render {w}x{h} smaller than target {W}x{H}'
crop = [b''.join(rws[y][x * bpp:x * bpp + 3] for x in range(W)) for y in range(H)]

# The card is a solid ground; any white pixel on its edges means Chrome clipped it.
bg = tuple(crop[0][0:3])
edges = [crop[0], crop[H - 1]] + [crop[y][0:3] + crop[y][(W - 1) * 3:(W - 1) * 3 + 3] for y in (H // 2,)]
bad = [i for i, row in enumerate(edges) if b'\xff\xff\xff' in row]
if bad or bg == (255, 255, 255):
    sys.exit(f'FAIL: card clipped (bg={bg}, bad edges={bad}) — Chrome viewport too small')
write_png(dst, W, H, crop)
print(f'cropped {w}x{h} -> {W}x{H}, ground={bg}')
