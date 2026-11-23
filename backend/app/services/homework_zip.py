"""Validate Android Studio ZIPs without extracting projects to disk."""

import re
import stat
import zipfile
import zlib
from itertools import pairwise
from pathlib import Path


def inspect_android_zip(path: Path, question: str) -> list[str]:
    try:
        with zipfile.ZipFile(path) as archive:
            if len(archive.infolist()) > 30_000:
                raise ValueError("压缩包目录过大，请清理缓存后重新打包")
            entries: dict[str, zipfile.ZipInfo] = {}
            for info in archive.infolist():
                raw = info.filename.replace("\\", "/")
                parts = raw.rstrip("/").split("/")
                if (
                    any(part in {"", ".", ".."} for part in parts)
                    or ":" in parts[0]
                    or stat.S_ISLNK(info.external_attr >> 16)
                    or info.flag_bits & 1
                ):
                    raise ValueError("压缩包含有异常路径、链接或加密文件，请重新打包")
                if any(a.lower() == "app" and b.lower() == "build" for a, b in pairwise(parts)):
                    raise ValueError("压缩包仍含 app/build，请删除该目录后重新打包")
                if not info.is_dir():
                    key = "/".join(parts)
                    if key in entries:
                        raise ValueError("压缩包包含重复路径，请重新打包")
                    entries[key] = info

            manifests = [
                name.removesuffix("app/src/main/AndroidManifest.xml")
                for name in entries
                if name == "app/src/main/AndroidManifest.xml"
                or name.endswith("/app/src/main/AndroidManifest.xml")
            ]
            if len(manifests) != 1:
                raise ValueError(
                    "每包须包含一个 Android 工程（缺少或有多个 app/src/main/AndroidManifest.xml）"
                )
            root = manifests[0]
            if not any(root + "app/build.gradle" + ext in entries for ext in ("", ".kts")):
                raise ValueError("缺少 app/build.gradle 或 app/build.gradle.kts")
            gradle = entries.get(root + "settings.gradle") or entries.get(
                root + "settings.gradle.kts"
            )
            if gradle is None or gradle.file_size > 128 * 1024:
                raise ValueError("缺少有效的 settings.gradle 或 settings.gradle.kts")
            settings = archive.read(gradle).decode("utf-8-sig", errors="replace")
            match = re.search(r"""(?m)^\s*rootProject\.name\s*=\s*["']([^"'\r\n]+)["']""", settings)
            project_name = match[1] if match else root.rstrip("/").rsplit("/", 1)[-1]
            if project_name != question:
                raise ValueError(
                    f"工程名应为 {question}（检查 settings.gradle 中的 rootProject.name）"
                )
            if any(".gradle" in name.split("/") for name in entries):
                return ["含 .gradle 缓存，建议删除后再打包"]
            return []
    except (zipfile.BadZipFile, NotImplementedError, RuntimeError, EOFError, zlib.error) as exc:
        raise ValueError("ZIP 无法读取，请重新压缩") from exc
