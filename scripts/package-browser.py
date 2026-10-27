"""Package the precompiled, offline browser preview using only Python's stdlib."""
from pathlib import Path
import shutil
root = Path(__file__).resolve().parent.parent
out = root / 'dist' / 'xpad-browser'
out.mkdir(parents=True, exist_ok=True)
for name in ('index.html', 'xpad.js', 'xpad.css', 'LICENSE'):
    shutil.copy2(root / name, out / name)
for name in ('react.production.min.js', 'react-dom.production.min.js'):
    (out / 'vendor').mkdir(exist_ok=True)
    shutil.copy2(root / 'vendor' / name, out / 'vendor' / name)
(out / 'assets').mkdir(exist_ok=True)
shutil.copy2(root / 'assets' / 'favicon.png', out / 'assets' / 'favicon.png')
shutil.make_archive(str(root / 'dist' / 'xpad-browser'), 'zip', out)
print(f'Browser preview: {out / "index.html"}')
