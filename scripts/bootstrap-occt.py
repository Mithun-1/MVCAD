"""Build the pinned, minimal shared CAD kernel (run in a compiler environment)."""
import argparse
import pathlib
import subprocess

COMMIT = "a016080bf6738d6aeae020badee4e888ad1540a5"
ROOT = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--jobs", default="4")
args = parser.parse_args()
source, build, install = (ROOT / ".tools" / p for p in ("occt-src", "occt-build", "occt"))
def run(*command):
    subprocess.run(command, check=True)
if not source.exists():
    run("git", "clone", "--depth", "1", "--branch", "V7_9_3",
        "https://github.com/Open-Cascade-SAS/OCCT.git", str(source))
actual = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
if actual != COMMIT:
    raise SystemExit("OCCT checkout does not match the pinned source commit")
run("cmake", "-S", str(source), "-B", str(build), "-G", "Ninja",
    "-DCMAKE_BUILD_TYPE=Release", "-DBUILD_LIBRARY_TYPE=Shared",
    "-DBUILD_MODULE_FoundationClasses=ON", "-DBUILD_MODULE_ModelingData=ON",
    "-DBUILD_MODULE_ModelingAlgorithms=ON", "-DBUILD_MODULE_Visualization=OFF",
    "-DBUILD_MODULE_ApplicationFramework=OFF", "-DBUILD_MODULE_DataExchange=OFF",
    "-DBUILD_MODULE_Draw=OFF", "-DBUILD_MODULE_DETools=OFF", "-DBUILD_DOC_Overview=OFF",
    "-DUSE_TCL=OFF", "-DUSE_TK=OFF", "-DUSE_FREETYPE=OFF", "-DUSE_TBB=OFF",
    "-DINSTALL_DIR_LAYOUT=Unix", f"-DINSTALL_DIR={install.as_posix()}",
    "-DINSTALL_DIR_CMAKE=lib/cmake/opencascade", "-DINSTALL_DIR_BIN=bin",
    "-DINSTALL_DIR_LIB=lib", "-DINSTALL_DIR_INCLUDE=include/opencascade")
run("cmake", "--build", str(build), "--parallel", args.jobs)
run("cmake", "--install", str(build))
