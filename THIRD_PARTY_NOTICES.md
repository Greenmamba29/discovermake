# Third-party notices

DiscoverMake includes or runs the following third-party software. This file lists components that
ship as copied files or as separately installed runtimes in our services; npm and PyPI
dependencies of the web app and the CAD worker carry their own license files in their packages.

## cadgen / text-to-cad

- Source: https://github.com/earthtojake/text-to-cad, release 0.7.20 (commit b48ff49)
- Used: `cadgen==0.7.20` installed unmodified in the CAD worker image (`/opt/cadgen`), run as a
  sandboxed subprocess; the cad skill docs (`skills/cad/SKILL.md` and three references) copied
  verbatim into `src/server/text-to-cad/guide/` as Make AI's model-writing guide.
- License: MIT

```
MIT License

Copyright (c) 2026 Thompson Labs LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The full text also ships at `src/server/text-to-cad/guide/LICENSE`.

## build123d

- Source: https://github.com/gumyr/build123d (0.11.1, installed by cadgen in the worker image)
- License: Apache License 2.0

## OCP / Open CASCADE Technology (`cadquery-ocp`, `cadquery-ocp-novtk`)

- Source: https://github.com/CadQuery/OCP and https://dev.opencascade.org
- Used: the unmodified upstream wheels, inside the CAD worker service only (CadQuery's venv and
  cadgen's venv). No patches.
- License: GNU LGPL 2.1 with the Open CASCADE exception

## CadQuery

- Source: https://github.com/CadQuery/cadquery (2.8, CAD worker)
- License: Apache License 2.0

## Node.js

- Source: https://nodejs.org (22.x, in the CAD worker image for cadgen's mesh export)
- License: MIT (and the licenses of its bundled dependencies, shipped with the binary)

## DejaVu Sans Bold (subset)

- Source: https://dejavu-fonts.github.io/ (fonts-dejavu-core 2.37)
- Used: `services/cad-worker/cad_worker/text_to_cad/templates/DejaVuSans-Bold-kids.ttf`, a subset
  with letters, digits and space only, for raised and engraved labels on the kid templates.
- License: Bitstream Vera Fonts license (DejaVu changes are in the public domain). Full text:
  `services/cad-worker/cad_worker/text_to_cad/templates/DejaVu-LICENSE.txt`.
