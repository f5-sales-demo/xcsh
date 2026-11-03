"""Render the citation generator's string-only mappings as readable TypeScript."""

import json
from collections.abc import Mapping, Sequence

_LINE_WIDTH = 120
_INDENT_WIDTH = 3


def _string(value: str) -> str:
    encoded = json.dumps(value, ensure_ascii=False)
    if value.count('"') > value.count("'"):
        content = encoded[1:-1].replace('\\"', '"').replace("'", "\\'")
        return "'" + content + "'"
    return encoded


def _key(value: str) -> str:
    if value == "__proto__":
        return '["__proto__"]'
    return value if value.replace("$", "_").isidentifier() else _string(value)


def _literal(value: object, level: int, *, sort_keys: bool) -> list[str]:
    if isinstance(value, str):
        return [_string(value)]
    if not isinstance(value, Mapping):
        message = "Citation mappings contain only strings and mapping objects"
        raise TypeError(message)
    if not value:
        return ["{}"]
    lines = ["{"]
    keys = sorted(value) if sort_keys else value
    for key in keys:
        if not isinstance(key, str):
            message = "Citation mapping keys must be strings"
            raise TypeError(message)
        key_source = _key(key)
        prefix = "\t" * (level + 1) + key_source + ": "
        rendered = _literal(value[key], level + 1, sort_keys=sort_keys)
        combined_width = len(prefix.expandtabs(_INDENT_WIDTH) + rendered[0] + ",")
        if (
            len(rendered) == 1
            and key_source[0] in ('"', "'")
            and combined_width > _LINE_WIDTH
        ):
            lines.extend([prefix.rstrip(), "\t" * (level + 2) + rendered[0] + ","])
        else:
            lines.extend([prefix + rendered[0], *rendered[1:-1]])
            if len(rendered) > 1:
                lines.append(rendered[-1] + ",")
            else:
                lines[-1] += ","
    return [*lines, "\t" * level + "}"]


def render_public_citation_exports(
    sources: Mapping[str, object], tables: Sequence[tuple[str, Mapping[str, object]]]
) -> str:
    """Render verified string-only exports with stable readable source layout."""
    parts = [
        "// Generated from verified release manifests and published sitemaps. Do not edit.",
        "export const PUBLIC_CITATION_SOURCES = "
        + "\n".join(_literal(sources, 0, sort_keys=False))
        + " as const;",
    ]
    for name, data in tables:
        value_type = (
            "string"
            if name
            in (
                "TERRAFORM_PUBLIC_DOCUMENTS",
                "API_PUBLIC_OPERATIONS",
                "API_PUBLIC_CATEGORIES",
            )
            else "{ title: string; url: string }"
        )
        parts.append(
            f"export const {name}: Readonly<Record<string, {value_type}>> = "
            + "\n".join(_literal(data, 0, sort_keys=True))
            + ";"
        )
    return "\n".join(parts) + "\n"
