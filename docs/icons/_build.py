"""Build sc-code icon PNG/ICO from SVG using headless Edge.

Renders the SVG (512x512 viewBox) to an oversized 2048x2048 window to avoid
Edge's viewport clipping, chroma-keys the magenta background to transparent,
then downscales straight to the target size. No cropping/re-centering is done,
so the layout defined inside the SVG (side margins ~6 units, vertical ~25 units)
is preserved exactly.

NOTE: chroma-key distance math MUST use int32/float, NOT int16 -- dark/light
pixels differ from #ff00ff by >181 per channel, whose squares (>=32761) overflow
int16 and produce NaN alpha, making dark fills / light strokes vanish.

The script resolves paths relative to itself. Edge is located from
SC_CODE_EDGE, PATH, or the standard install locations derived from environment
variables; set SC_CODE_EDGE to msedge.exe if it cannot be found.
"""
from PIL import Image
import subprocess, pathlib, os, time, shutil
import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
SVG = HERE / "sc-code.svg"

def find_edge():
    candidates = [os.environ.get("SC_CODE_EDGE"), shutil.which("msedge"), shutil.which("msedge.exe")]
    for base in (os.environ.get("PROGRAMFILES(X86)"), os.environ.get("PROGRAMFILES"), os.environ.get("LOCALAPPDATA")):
        if base:
            candidates.append(str(pathlib.Path(base) / "Microsoft" / "Edge" / "Application" / "msedge.exe"))
    for candidate in candidates:
        if candidate and pathlib.Path(candidate).is_file():
            return candidate
    raise SystemExit("Microsoft Edge not found; set SC_CODE_EDGE to msedge.exe")

EDGE = find_edge()

RENDER = 2048   # render size (4x the 512 viewBox, avoids Edge clipping)
TARGET = 1024   # master output size

svg_text = SVG.read_text(encoding="utf-8")
svg_big = svg_text.replace('width="512"', f'width="{RENDER}"').replace('height="512"', f'height="{RENDER}"')

html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
html,body{{margin:0;padding:0;background:#ff00ff;width:{RENDER}px;height:{RENDER}px;overflow:hidden}}
svg{{display:block;width:{RENDER}px;height:{RENDER}px;background:#ff00ff}}
</style></head><body>
{svg_big}
</body></html>"""

html_path = HERE / "_b.html"
raw_path = HERE / "_raw.png"
html_path.write_text(html, encoding="utf-8")

print(f"Rendering at {RENDER}x{RENDER}...")
subprocess.run([
    EDGE, "--headless=new", "--disable-gpu", "--hide-scrollbars",
    "--force-device-scale-factor=1",
    f"--window-size={RENDER},{RENDER}", f"--screenshot={raw_path}",
    f"file:///{str(html_path).replace(os.sep,'/')}?t={int(time.time()*1000)}"
], check=True, capture_output=True)

img = Image.open(raw_path).convert("RGBA")
arr = np.array(img)

# Chroma key (magenta) -> transparent.  USE float to avoid int16 overflow!
rgb = arr[:,:,:3].astype(np.float32)
key = np.array([255.0, 0.0, 255.0], dtype=np.float32)
d = np.sqrt(((rgb - key) ** 2).sum(axis=2))
alpha = np.clip((d - 24.0) / 40.0, 0.0, 1.0) * 255.0
arr[:,:,3] = alpha.astype(np.uint8)
# Set fully-keyed pixels to black (avoids magenta fringing on edges)
keyed = d < 24.0
arr[keyed, 0] = 0
arr[keyed, 1] = 0
arr[keyed, 2] = 0
out = Image.fromarray(arr, "RGBA")

# Straight downscale to master size (no crop / re-center)
master = out.resize((TARGET, TARGET), Image.LANCZOS)
master.save(HERE / "sc-code-1024.png")

# Verify content bbox at master size
marr = np.array(master)
opaque = marr[:,:,3] > 10
ys, xs = np.where(opaque)
print(f"Master content bbox: x[{xs.min()},{xs.max()}] y[{ys.min()},{ys.max()}]  "
      f"L={xs.min()} R={TARGET-1-xs.max()} T={ys.min()} B={TARGET-1-ys.max()}")

# Sanity check: confirm dark body fill and S stroke survived
center_region = marr[400:600, 400:600, :3]  # rough body center
dark_pixels = (center_region[:,:,0] < 80) & (center_region[:,:,2] < 80)
print(f"Dark-body pixels in center 200x200 patch: {dark_pixels.sum()} (expect large)")
s_region = marr[400:700, 200:500, :3]  # rough S area
light_pixels = (s_region[:,:,0] > 230) & (s_region[:,:,1] > 230) & (s_region[:,:,2] > 230)
print(f"Light (S-stroke) pixels in S region: {light_pixels.sum()} (expect non-zero)")

# Downscale to other sizes
for s in [512,256,128,64,48,32,16]:
    master.resize((s,s), Image.LANCZOS).save(HERE / f"sc-code-{s}.png")

# Build ICO (largest first). 24px exists only inside the ICO.
ico_sizes = [256,128,64,48,32,24,16]
imgs = []
for s in ico_sizes:
    p = HERE / f"sc-code-{s}.png"
    imgs.append(Image.open(p).convert("RGBA") if p.exists() else master.resize((s,s), Image.LANCZOS))
imgs[0].save(HERE / "sc-code.ico", format="ICO",
             sizes=[(s,s) for s in ico_sizes], append_images=imgs[1:])
print(f"ICO size: {(HERE / 'sc-code.ico').stat().st_size} bytes")

# Cleanup temp
for p in [html_path, raw_path]:
    if p.exists(): p.unlink()
print("DONE")
