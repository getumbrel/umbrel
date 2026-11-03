# Symbols

Generates `app/src/main/kotlin/com/umbrel/android/ui/Symbols.kt`, the app's icons: Google's
Material Symbols Rounded (Apache License 2.0), each in the weights the app draws it at, plus
icons assembled from Material pieces where Material has nothing for an SF Symbol the iOS app
uses.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python gen_symbols.py
```

Material's SVGs are downloaded from google/material-design-icons into `build/`.

- **A new icon or weight:** add it to `weights.json` (and to `STOCK` in `gen_symbols.py` if
  it's new), then generate. A weight follows the weight iOS uses in the same place: regular
  is 400, medium 500, semibold 600, bold 700.
- **A new assembled icon:** add a function to `ICONS` in `custom_icons.py`. Place its pieces
  where the SF Symbol puts its own: render the symbol with
  `swift measure.swift <symbol> build/render.png` and read the boxes and badge gap with
  `.venv/bin/python measure_pieces.py build/render.png`. `custom_icons.py <Name> <weight>`
  writes one icon to `build/` as an SVG for checking.
