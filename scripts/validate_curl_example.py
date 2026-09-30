"""Parse curl examples without executing commands or contacting an API."""

import json
import re
import shlex
import sys

HTTP_PORT = 80


def require(condition: object, message: str) -> None:
    """Reject invalid output even when Python optimization is enabled."""
    if not condition:
        raise SystemExit(message)


def validate(response: str, method: str) -> None:
    """Check the HTTP method, URL, headers and requested JSON payload."""
    blocks = re.findall(r"```(?:bash|sh|shell|console)?\s*\n([\s\S]*?)```", response)
    command = next(
        (
            block.strip()
            for block in blocks
            if re.search(r"^curl\b", block.strip(), re.MULTILINE)
        ),
        "",
    )
    require(command, "No fenced curl command found")
    args = shlex.split(command.replace("\\\n", ""), comments=True)
    require(args[0] == "curl", "Expected curl command")
    headers: list[str] = []
    data = None
    actual_method = "GET"
    urls: list[str] = []
    index = 1
    while index < len(args):
        arg = args[index]
        if arg in (
            "-H",
            "--header",
            "-X",
            "--request",
            "-d",
            "--data",
            "--data-raw",
            "--data-binary",
            "--json",
            "--url",
        ):
            index += 1
            value = args[index]
            if arg in ("-H", "--header"):
                headers.append(value)
            elif arg in ("-X", "--request"):
                actual_method = value.upper()
            elif arg == "--url":
                urls.append(value)
            else:
                data = value
                if actual_method == "GET":
                    actual_method = "POST"
                if arg == "--json":
                    headers.append("Content-Type: application/json")
        elif not arg.startswith("-"):
            urls.append(arg)
        index += 1
    require(actual_method == method, "Incorrect HTTP method")
    require(len(urls) == 1, "Expected exactly one URL")
    require(
        re.fullmatch(
            r"\$\{?XCSH_API_URL\}?/api/config/namespaces/default/http_loadbalancers",
            urls[0],
        ),
        "Incorrect API URL or endpoint",
    )
    require(
        any(
            re.fullmatch(
                r"Authorization:\s*APIToken\s+\$\{?XCSH_API_TOKEN\}?",
                header,
                re.IGNORECASE,
            )
            for header in headers
        ),
        "Incorrect authentication header",
    )
    require(
        re.search(r'"\$\{?XCSH_API_URL\}?/api/', command),
        "API URL must be double quoted",
    )
    require(
        re.search(
            r'"Authorization:\s*APIToken\s+\$\{?XCSH_API_TOKEN\}?"',
            command,
            re.IGNORECASE,
        ),
        "Credential header must be double quoted",
    )
    if method == "POST":
        require(
            any(
                header.lower() == "content-type: application/json" for header in headers
            ),
            "Missing JSON Content-Type",
        )
        require(data is not None, "Missing JSON payload")
        body = json.loads(data)
        require(body["metadata"]["name"] == "curl-example", "Incorrect resource name")
        require(body["metadata"]["namespace"] == "default", "Incorrect namespace")
        require(
            body["spec"]["domains"] == ["curl-example.example.com"], "Incorrect domains"
        )
        require(body["spec"]["http"]["port"] == HTTP_PORT, "Incorrect HTTP port")
    else:
        require(data is None, "GET example must not have a body")


if __name__ == "__main__":
    validate(sys.stdin.read(), sys.argv[1])
