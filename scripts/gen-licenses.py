#!/usr/bin/env python3
"""Writes frontend/src/legal/licenses.md from the licence files of the Go
modules compiled into the app. Run after changing dependencies:

    python3 scripts/gen-licenses.py
"""
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (module, display name, licence) for everything linked into the Windows exe
# (see `go version -m EastapeDownloader.exe`).
MODULES = [
    ("github.com/wailsapp/wails/v2", "Wails", "MIT"),
    ("github.com/wailsapp/go-webview2", "go-webview2", "MIT"),
    ("github.com/leaanthony/go-ansi-parser", "go-ansi-parser", "MIT"),
    ("github.com/leaanthony/slicer", "slicer", "MIT"),
    ("github.com/leaanthony/u", "u", "MIT"),
    ("github.com/rivo/uniseg", "uniseg", "MIT"),
    ("github.com/pkg/errors", "errors", "BSD 2-Clause"),
    ("golang.org/x/net", "Go networking libraries", "BSD 3-Clause"),
    ("golang.org/x/sys", "Go system libraries", "BSD 3-Clause"),
    ("golang.org/x/time", "Go rate limiting library", "BSD 3-Clause"),
]


def module_dir(mod):
    env = dict(os.environ, GOTOOLCHAIN="local", GOOS="windows")
    return subprocess.check_output(["go", "list", "-m", "-f", "{{.Dir}}", mod], cwd=ROOT, env=env, text=True).strip()


def licence_text(d):
    for name in sorted(os.listdir(d)):
        if name.lower().startswith(("license", "licence", "copying")):
            with open(os.path.join(d, name), encoding="utf-8") as f:
                return f.read().strip()
    raise SystemExit(f"no licence file in {d}")


def go_root_licence():
    env = dict(os.environ, GOTOOLCHAIN="local")
    root = subprocess.check_output(["go", "env", "GOROOT"], env=env, text=True).strip()
    with open(os.path.join(root, "LICENSE"), encoding="utf-8") as f:
        return f.read().strip()


def main():
    out = [
        "# Open-source licences",
        "",
        "Eastape Downloader · Version 1.1",
        "",
        "Eastape Downloader is © 2026 Eastape Tech. All rights reserved. It is built with the open-source software below, used under the licence shown for each. We are grateful to their authors.",
        "",
        "## Components",
        "",
        "- **Go** programming language and standard library: BSD 3-Clause, Copyright 2009 The Go Authors",
    ]
    for mod, name, lic in MODULES:
        out.append(f"- **{name}** ({mod}): {lic}")
    out.append("- **Microsoft Edge WebView2 Runtime**: Microsoft Software License Terms. Provided by Microsoft as part of Windows, or installed by the Eastape Downloader installer when missing.")
    out += ["", "## Licence texts", ""]

    out += ["### Go", "", "```", go_root_licence(), "```", ""]
    for mod, name, _ in MODULES:
        out += [f"### {name} ({mod})", "", "```", licence_text(module_dir(mod)), "```", ""]

    out += [
        "## Credits",
        "",
        "Eastape Downloader is developed by Eastape Tech. Made by Creators, for Creators.",
        "",
        "Developer: Navi Joshi & Veerinder Singh",
        "",
    ]
    path = os.path.join(ROOT, "frontend", "src", "legal", "licenses.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    print("wrote", path)


if __name__ == "__main__":
    main()
