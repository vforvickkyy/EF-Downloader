#!/usr/bin/env python3
"""Writes frontend/src/legal/licenses.md from the licence files of the Go
modules compiled into the app. Run after changing dependencies:

    python3 scripts/gen-licenses.py
"""
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, "wails.json"), encoding="utf-8") as f:
    VERSION = ".".join(__import__("json").load(f)["info"]["productVersion"].split(".")[:2])

# Friendlier names for some modules; others are listed by their path.
NAMES = {
    "github.com/wailsapp/wails/v2": "Wails",
    "github.com/wailsapp/go-webview2": "go-webview2",
    "github.com/wailsapp/mimetype": "mimetype",
    "github.com/leaanthony/go-ansi-parser": "go-ansi-parser",
    "github.com/leaanthony/slicer": "slicer",
    "github.com/leaanthony/u": "u",
    "github.com/rivo/uniseg": "uniseg",
    "github.com/pkg/errors": "errors",
    "github.com/pkg/browser": "browser",
    "github.com/bep/debounce": "debounce",
    "github.com/go-ole/go-ole": "go-ole",
    "github.com/google/uuid": "uuid",
    "github.com/samber/lo": "lo",
    "github.com/tkrajina/go-reflector": "go-reflector",
    "golang.org/x/net": "Go networking libraries",
    "golang.org/x/sys": "Go system libraries",
    "golang.org/x/text": "Go text libraries",
    "golang.org/x/time": "Go rate limiting library",
}


def modules():
    """Every module compiled into the Windows app (same tags as wails build)."""
    env = dict(os.environ, GOTOOLCHAIN="local", GOOS="windows", GOARCH="amd64", CGO_ENABLED="0")
    out = subprocess.check_output(
        ["go", "list", "-deps", "-tags", "desktop,production",
         "-f", "{{with .Module}}{{if not .Main}}{{.Path}}{{end}}{{end}}", "."],
        cwd=ROOT, env=env, text=True)
    return sorted(set(out.split()))


def licence_kind(text):
    head = text[:3000]
    if "Apache License" in head:
        return "Apache 2.0"
    if "Permission is hereby granted, free of charge" in head:
        return "MIT"
    if "Redistribution and use in source and binary forms" in head:
        return "BSD 3-Clause" if "Neither the name" in head or "names of its contributors" in head else "BSD 2-Clause"
    raise SystemExit("unknown licence:\n" + head[:300])


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
        f"Eastape Downloader · Version {VERSION}",
        "",
        "Eastape Downloader is © 2026 Eastape Tech. All rights reserved. It is built with the open-source software below, used under the licence shown for each. We are grateful to their authors.",
        "",
        "## Components",
        "",
        "- **Go** programming language and standard library: BSD 3-Clause, Copyright 2009 The Go Authors",
    ]
    texts = []
    for mod in modules():
        text = licence_text(module_dir(mod))
        name = NAMES.get(mod, mod)
        out.append(f"- **{name}** ({mod}): {licence_kind(text)}")
        texts += [f"### {name} ({mod})", "", "```", text, "```", ""]
    out.append("- **Microsoft Edge WebView2 Runtime**: Microsoft Software License Terms. Provided by Microsoft as part of Windows, or installed by the Eastape Downloader installer when missing.")
    out.append("- **NSIS** (Nullsoft Scriptable Install System), used to build the installer: zlib/libpng licence")
    out += ["", "## Licence texts", ""]
    out += ["### Go", "", "```", go_root_licence(), "```", ""]
    out += texts

    out += [
        "## Credits",
        "",
        "Made by Creators, for Creators.",
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
