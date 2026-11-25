"""Validate Android Studio ZIPs without extracting projects to disk."""

import re
import stat
import xml.etree.ElementTree as ET
import zipfile
import zlib
from itertools import pairwise
from pathlib import Path
from typing import BinaryIO

from pypinyin import lazy_pinyin

MAX_CONFIG_BYTES = 128 * 1024
_PACKAGE = r"[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+"
_GRADLE_PACKAGES = re.compile(
    rf"""(?m)^[ \t]*(applicationId|namespace)\s*(?:=\s*|\(\s*)?["']({_PACKAGE})["']"""
)
_GRADLE_TOKEN = re.compile(
    r"""//[^\n]*|/\*[\s\S]*?(?:\*/|\Z)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'"""
)
# Common surname readings that differ from the default reading of the character.
_SURNAMES = {
    "仇": "qiu",
    "区": "ou",
    "单": "shan",
    "曾": "zeng",
    "查": "zha",
    "解": "xie",
    "重": "chong",
    "长孙": "zhangsun",
}


def package_prefix(real_name: str) -> str | None:
    """Use the roster name. Names containing the middle dot are exempt."""
    name = real_name.strip()
    if not name or "·" in name:
        return None
    for length in (2, 1):
        surname = _SURNAMES.get(name[:length])
        if surname:
            return surname + "".join(lazy_pinyin(name[length:])).lower()
    return "".join(lazy_pinyin(name)).lower()


def config_text(archive: zipfile.ZipFile, entry: zipfile.ZipInfo) -> str:
    if entry.file_size > MAX_CONFIG_BYTES:
        raise ValueError("工程配置文件超过 128 KB，请精简后重新打包")
    with archive.open(entry) as stream:
        content = stream.read(MAX_CONFIG_BYTES + 1)
    if len(content) > MAX_CONFIG_BYTES:
        raise ValueError("工程配置文件超过 128 KB，请精简后重新打包")
    return content.decode("utf-8-sig", errors="replace")


def validate_android_package(
    archive: zipfile.ZipFile,
    gradle: zipfile.ZipInfo,
    manifest: zipfile.ZipInfo,
    prefix: str,
    question: str,
) -> None:
    gradle_text = _GRADLE_TOKEN.sub(
        lambda token: re.sub(r"[^\n]", " ", token[0]) if token[0].startswith("/") else token[0],
        config_text(archive, gradle),
    )
    declarations = dict.fromkeys(_GRADLE_PACKAGES.findall(gradle_text))
    if not any(field == "namespace" for field, _ in declarations):
        manifest_text = config_text(archive, manifest)
        if "<!DOCTYPE" in manifest_text:
            raise ValueError("AndroidManifest.xml 含不受支持的 DTD 声明")
        try:
            manifest_package = ET.fromstring(manifest_text).get("package")
        except ET.ParseError as exc:
            raise ValueError("AndroidManifest.xml 无法读取，请检查 XML 格式") from exc
        if manifest_package:
            declarations["AndroidManifest.xml 的 package", manifest_package] = None

    if not declarations:
        raise ValueError(
            f"无法确认包名，请在 app/build.gradle 中使用自己的 {prefix}.{question.lower()}"
        )
    for field, package in declarations:
        if not re.fullmatch(_PACKAGE, package) or not package.startswith(f"{prefix}."):
            suffix = package.rsplit(".", 1)[-1]
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", suffix):
                suffix = question.lower()
            raise ValueError(
                f"{field} 目前是 {package[:120]}。请把包名改成自己的 {prefix}.{suffix[:80]}"
            )


def inspect_android_zip(path: Path | BinaryIO, question: str, real_name: str) -> list[str]:
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
            app_gradle = entries.get(root + "app/build.gradle") or entries.get(
                root + "app/build.gradle.kts"
            )
            if app_gradle is None:
                raise ValueError("缺少 app/build.gradle 或 app/build.gradle.kts")
            gradle = entries.get(root + "settings.gradle") or entries.get(
                root + "settings.gradle.kts"
            )
            if gradle is None:
                raise ValueError("缺少有效的 settings.gradle 或 settings.gradle.kts")
            settings = config_text(archive, gradle)
            match = re.search(r"""(?m)^\s*rootProject\.name\s*=\s*["']([^"'\r\n]+)["']""", settings)
            project_name = match[1] if match else root.rstrip("/").rsplit("/", 1)[-1]
            if project_name != question:
                raise ValueError(
                    f"工程名应为 {question}（检查 settings.gradle 中的 rootProject.name）"
                )
            prefix = package_prefix(real_name)
            if prefix:
                validate_android_package(
                    archive,
                    app_gradle,
                    entries[root + "app/src/main/AndroidManifest.xml"],
                    prefix,
                    question,
                )
            if any(".gradle" in name.split("/") for name in entries):
                return ["含 .gradle 缓存，建议删除后再打包"]
            return []
    except (zipfile.BadZipFile, NotImplementedError, RuntimeError, EOFError, zlib.error) as exc:
        raise ValueError("ZIP 无法读取，请重新压缩") from exc
