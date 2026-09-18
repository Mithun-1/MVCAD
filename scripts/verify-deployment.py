"""Run the installed app with development runtime paths removed."""
import argparse
import os
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("prefix", type=Path)
    args = parser.parse_args()
    prefix = args.prefix.resolve()
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(("QT_", "QML_", "DYLD_", "LD_LIBRARY_PATH"))}
    if sys.platform == "win32":
        executable = prefix / "bin/MVCAD.exe"
        windows = Path(os.environ["SystemRoot"])
        env["PATH"] = os.pathsep.join(map(str, [executable.parent, windows / "System32", windows]))
    elif sys.platform == "darwin":
        executable = prefix / "MVCAD.app/Contents/MacOS/MVCAD"
        env["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
        # Ensure the bundle cannot silently load the build machine's kernel/Qt.
        candidates = [executable] + list((prefix / "MVCAD.app/Contents").rglob("*.dylib"))
        candidates += [p for p in (prefix / "MVCAD.app/Contents/Frameworks").rglob("*")
                       if p.is_file() and p.parent.name == "A" and p.suffix == ""]
        for binary in candidates:
            output = subprocess.check_output(["otool", "-L", str(binary)], text=True)
            # -L includes a dylib's own LC_ID_DYLIB, which is not a loaded
            # dependency. Qt plugins may retain an absolute self identity.
            identities = {line.strip() for line in subprocess.check_output(
                ["otool", "-D", str(binary)], text=True).splitlines()[1:]}
            for line in output.splitlines()[1:]:
                dependency = line.strip().split(" (", 1)[0]
                if dependency in identities:
                    continue
                if dependency.startswith("/") and not dependency.startswith(("/System/Library/", "/usr/lib/")):
                    raise RuntimeError(f"Non-system external dependency in {binary}: {dependency}")
    else:
        raise RuntimeError("Deployment check supports Windows and macOS")
    # Exercise the shipped native platform plugin. Deployment tools intentionally
    # omit the offscreen plugin used by build-tree tests.
    screenshot = prefix.parent / "deployed-ui-smoke.png"
    subprocess.run([str(executable), "--smoke-test", "--screenshot", str(screenshot)],
                   cwd=prefix, env=env, check=True, timeout=180)
    if not screenshot.is_file() or screenshot.stat().st_size == 0:
        raise RuntimeError("Installed application did not produce its smoke screenshot")
    print(f"Verified installed runtime: {executable}")


if __name__ == "__main__":
    main()
