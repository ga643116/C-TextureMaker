# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
"""Loopback-only developer server; the portable application needs no server."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
from pathlib import Path
import sys

SimpleHTTPRequestHandler.extensions_map[".mjs"] = "text/javascript"
root = Path(__file__).resolve().parent.parent
port = int(sys.argv[1]) if len(sys.argv) > 1 else 41784
handler = partial(SimpleHTTPRequestHandler, directory=str(root))
print(f"Developer UI: http://127.0.0.1:{port}/app/", flush=True)
print(f"Pixel checks: http://127.0.0.1:{port}/tests/browser.html", flush=True)
try:
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
except KeyboardInterrupt:
    pass
