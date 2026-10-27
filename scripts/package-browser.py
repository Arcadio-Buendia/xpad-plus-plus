"""Package the precompiled, offline browser preview using only Python's stdlib."""
from pathlib import Path
import shutil
import argparse
root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output-dir', type=Path, default=root / 'dist' / 'xpad-browser')
args = parser.parse_args()
out = args.output_dir.expanduser().resolve()
out.mkdir(parents=True, exist_ok=True)
for name in ('index.html', 'xpad.js', 'xpad.css', 'LICENSE'):
    shutil.copy2(root / name, out / name)
for name in ('react.production.min.js', 'react-dom.production.min.js'):
    (out / 'vendor').mkdir(exist_ok=True)
    shutil.copy2(root / 'vendor' / name, out / 'vendor' / name)
(out / 'assets').mkdir(exist_ok=True)
shutil.copy2(root / 'assets' / 'favicon.png', out / 'assets' / 'favicon.png')
(out / 'assets' / 'fonts').mkdir(exist_ok=True)
for font_asset in (root / 'assets' / 'fonts').glob('Kalam-*'):
    shutil.copy2(font_asset, out / 'assets' / 'fonts' / font_asset.name)
shutil.make_archive(str(out), 'zip', out)
print(f'Browser preview: {out / "index.html"}')
