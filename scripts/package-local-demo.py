#!/usr/bin/env python3
"""Create a source-free local deployment ZIP from an explicit, secret-free allowlist."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    "compose.yml", ".env.example", "README.md", "setup.mjs", "initialize.mjs",
    "check.mjs", "start.sh", "start.command", "start.ps1", "start.bat",
)


def package(output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        for name in FILES:
            info = ZipInfo(f"ielts-practice-local-demo/{name}")
            info.create_system = 3
            info.external_attr = (0o100755 if name in ("start.sh", "start.command") else 0o100644) << 16
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, (ROOT / "deploy/demo" / name).read_bytes())
    with ZipFile(output) as archive:
        assert archive.testzip() is None
        assert {Path(n).name for n in archive.namelist()} == set(FILES)
        assert not any(Path(n).name in (".env", "demo-login.txt") for n in archive.namelist())


if __name__ == "__main__":
    output = ROOT / "dist/ielts-practice-local-demo.zip"
    package(output)
    print(f"Created {output} ({output.stat().st_size:,} bytes); no keys or user data included.")
