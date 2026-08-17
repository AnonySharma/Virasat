#!/bin/sh
# Type-check a SINGLE lib file under the same lenient policy as jsconfig.json
# (strictNullChecks + noImplicitThis, noImplicitAny OFF), together with the
# ambient window-globals.d.ts. Used as the per-file feedback loop while
# expanding // @ts-check across lib/ — a clean exit (no output, status 0)
# means the file is ready. Not part of the app; not shipped.
#
#   scripts/check-file.sh lib/features/image-export.js
#
# checkJs is forced true here so the file is checked whether or not it has the
# // @ts-check line yet, which lets you see the findings before you fix them.
set -e
[ -n "$1" ] || { echo "usage: check-file.sh <lib/path.js>"; exit 2; }
# Write the temp config into the repo root (not /tmp) so the relative "files"
# paths resolve against the repo, and use a dotted name so it's easy to ignore.
cfg=".jsc-tmp-$$.json"
cat > "$cfg" <<EOF
{
  "compilerOptions": {
    "allowJs": true, "checkJs": true, "noEmit": true,
    "strictNullChecks": true, "noImplicitThis": true,
    "target": "es2022", "module": "esnext", "moduleResolution": "bundler",
    "lib": ["es2022", "dom", "dom.iterable"], "skipLibCheck": true, "types": []
  },
  "files": ["types/window-globals.d.ts", "$1"]
}
EOF
trap 'rm -f "$cfg"' EXIT
npx -y -p typescript@5 tsc --noEmit -p "$cfg"
