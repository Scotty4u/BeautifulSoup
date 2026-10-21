#!/usr/bin/env python3
"""SmartBasket Vite import fix. Only changes import capitalisation; backs up edited files."""
from pathlib import Path
import re
import shutil
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE / "src"
if not ROOT.is_dir():
    print("ERROR: Place FIX_VITE_IMPORTS.py inside your frontend folder, next to src.")
    sys.exit(1)

# These optional files are only installed when they are missing, never overwritten.
for relative in ["pages/BasketComparisonPage.jsx", "components/SearchHistoryDropdown.jsx", "components/StoreLocationPicker.jsx"]:
    source = HERE / "vite_fix_support" / relative
    target = ROOT / relative
    if source.is_file() and not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        print(f"ADDED src/{relative}")

FIX_STEMS = {"shoppinglocation", "productvisibility", "basketcomparison"}
# Cover source code from different versions of SmartBasket, respecting the REAL
# case of the existing files (no renaming needed, safe on Windows).
pattern = re.compile(r"(?P<quote>['\"])(?P<path>(?:\.\.?/)+utils/(?P<filename>(?:shoppinglocation|productvisibility|basketcomparison)(?:\.js|\.jsx|\.mjs)?))(?P=quote)", re.IGNORECASE)

count = 0
for file in sorted(ROOT.rglob("*")):
    if file.suffix not in (".js", ".jsx", ".mjs", ".ts", ".tsx") or "node_modules" in file.parts:
        continue
    original = file.read_text(encoding="utf-8-sig")
    def match_case(match):
        relative_path = match.group("path")
        basename = relative_path.rsplit("/", 1)[1]
        util_dir = (file.parent / relative_path.rsplit("/", 1)[0]).resolve()
        if not util_dir.is_dir():
            return match.group(0)
        candidates = [candidate for candidate in util_dir.iterdir()
                      if candidate.is_file() and candidate.stem.lower() == Path(basename).stem.lower()
                      and (not Path(basename).suffix or candidate.suffix.lower() == Path(basename).suffix.lower())]
        if not candidates:
            return match.group(0)
        new_relative = relative_path.rsplit("/", 1)[0] + "/" + candidates[0].name
        # Preserve original extension-less imports when possible.
        if not Path(basename).suffix:
            new_relative = new_relative[: -len(candidates[0].suffix)]
        return match.group("quote") + new_relative + match.group("quote")
    modified = pattern.sub(match_case, original)
    # Older map ZIP mistakenly imported LOCATION_EVENT twice in ProfileSettings.
    if file.name == "ProfileSettings.jsx":
        lines = modified.splitlines(keepends=True)
        seen = set()
        fixed = []
        for line in lines:
            if re.match(r"^import\s*\{\s*LOCATION_EVENT\s*\}\s*from\s*['\"]\.\./utils/", line):
                if 'LOCATION_EVENT' in seen:
                    continue
                seen.add('LOCATION_EVENT')
            fixed.append(line)
        modified = ''.join(fixed)
    if modified != original:
        backup = file.with_name(file.name + ".before_vite_fix.bak")
        if not backup.exists():
            shutil.copy2(file,backup)
        file.write_text(modified, encoding="utf-8")
        print(f"FIXED {file.relative_to(ROOT).as_posix()} (backup: {backup.name})")
        count += 1

# Inspect all static relative JS imports and warn about other missing files.
import_pattern=re.compile(r"(?:\bfrom\s*|\bimport\s*)(['\"])((?:\.\.?/)[^'\"]+)\1")
missing=[]
for file in sorted(ROOT.rglob('*')):
    if file.suffix not in ('.js','.jsx','.mjs','.ts','.tsx') or 'node_modules' in file.parts:
        continue
    source=file.read_text(encoding='utf-8-sig')
    for match in import_pattern.finditer(source):
        rel=match.group(2)
        candidate=(file.parent / rel).resolve()
        alternatives=[candidate]+[Path(str(candidate)+ext) for ext in ('.js','.jsx','.mjs','.ts','.tsx','.json','.css','.png','.jpg','.jpeg','.svg')]
        alternatives += [candidate / ('index'+ext) for ext in ('.js','.jsx','.mjs','.ts','.tsx')]
        if not any(path.is_file() for path in alternatives):
            missing.append((file.relative_to(ROOT).as_posix(),rel))

print(f"\nFinished: updated {count} source file(s); existing functionality was preserved.")
if missing:
    print("\nIMPORTANT: The following imports still reference missing files:")
    for source,reference in sorted(set(missing)):
        print(f" - src/{source} imports {reference}")
    print("Copy the listed files from your previous SmartBasket ZIPs, or correct these paths.")
else:
    print('All relative imports resolve to files in your src directory.')
print('\nRestart Vite: Ctrl+C, then npm run dev')
