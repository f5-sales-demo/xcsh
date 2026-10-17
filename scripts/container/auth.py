"""Explicit vendor authentication into container-owned session state."""

import os
import re
import subprocess
import sys
from pathlib import Path


def run(
    argv: list[str],
    *,
    stdin_text: str | None = None,
    interactive: bool = False,
    environment: dict[str, str] | None = None,
) -> None:
    """Execute one fixed vendor recipe and retain sensitive errors privately."""
    if argv[0] not in {"az", "sf", "gh", "glab", "aws", "gcloud"}:
        msg = "Unsupported authentication executable"
        raise ValueError(msg)
    result = subprocess.run(  # noqa: S603 - fixed vendor recipes; no shell interpretation.
        argv,
        input=stdin_text,
        text=True,
        stdin=None if interactive or stdin_text is not None else subprocess.DEVNULL,
        stdout=None if interactive else subprocess.PIPE,
        stderr=None if interactive else subprocess.PIPE,
        check=False,
        env=environment,
        # Vendor defaults must stay in private state even when a workspace is a project.
        cwd=os.environ["HOME"] if os.environ.get("XCSH_CONTAINER") == "1" else None,
    )
    if result.returncode:
        if os.environ.get("XCSH_CONTAINER") == "1":
            diagnostic = result.stderr or ""
            sensitive = [
                value
                for name, value in os.environ.items()
                if any(
                    part in name
                    for part in ("TOKEN", "SECRET", "PASSWORD", "API_KEY", "AUTH_URL")
                )
            ]
            if os.environ.get("SF_AUTH_URL", "").startswith("force://"):
                sensitive.extend(
                    os.environ["SF_AUTH_URL"]
                    .removeprefix("force://")
                    .split("@", 1)[0]
                    .split(":")[1:]
                )
            for value in sensitive:
                if value:
                    diagnostic = diagnostic.replace(value, "[credential]")
            directory = Path(os.environ["HOME"]) / ".xcsh" / "auth-diagnostics"
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            (directory / (argv[0] + ".stderr")).write_text(diagnostic)
            (directory / (argv[0] + ".stderr")).chmod(0o600)
        # Vendor output can contain tokens or personal identifiers. Keep it private.
        message = (result.stderr or "").lower()
        category = "authentication_or_authorization"
        for markers, label in (
            (("certificate", "ssl"), "certificate_trust"),
            (("proxy",), "proxy"),
            (("429", "rate limit"), "rate_limit"),
            (("expired",), "expired_credentials"),
            (("403", "scope", "forbidden", "permission"), "insufficient_authorization"),
            (("401", "invalid", "malformed"), "invalid_credentials"),
            (("timeout", "resolve", "connect"), "endpoint_unavailable"),
        ):
            if any(marker in message for marker in markers):
                category = label
                break
        msg = f"CLI failed ({category}); check inputs and service access. Portable credentials tied to the Mac keychain require explicit container login."
        raise ValueError(msg)


def require(*names: str) -> list[str]:
    """Require named environment inputs without rendering their values."""
    if any(not os.environ.get(name, "").strip() for name in names):
        msg = "Required authentication inputs: " + ", ".join(names)
        raise ValueError(msg)
    values = [os.environ[name] for name in names]
    if any(re.search(r"(?:\[|<)redacted\b", value, re.IGNORECASE) for value in values):
        msg = "Authentication inputs are redacted; use an actual private credential file or explicit container login"
        raise ValueError(msg)
    return values


def _login_azure(interactive: bool) -> None:
    """Initialize the explicit azure session in private state."""
    env = os.environ
    names = ("AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_TENANT_ID")
    if any(env.get(name) for name in names):
        client, secret, tenant = require(*names)
        run(
            [
                "az",
                "login",
                "--service-principal",
                "--username",
                client,
                "--password",
                secret,
                "--tenant",
                tenant,
                "--allow-no-subscriptions",
                "--output",
                "none",
            ]
        )
    elif interactive:
        run(["az", "login", "--use-device-code"], interactive=True)
    else:
        require(*names)
    if env.get("AZURE_SUBSCRIPTION_ID"):
        run(["az", "account", "set", "--subscription", env["AZURE_SUBSCRIPTION_ID"]])


def _login_salesforce(_interactive: bool) -> None:
    """Initialize the explicit salesforce session in private state."""
    env = os.environ
    if env.get("SF_AUTH_URL"):
        (auth_url,) = require("SF_AUTH_URL")
        run(
            # The stdin flag consumes following argv in the pinned CLI; put it last.
            ["sf", "org", "login", "sfdx-url", "--set-default", "--sfdx-url-stdin"],
            stdin_text=auth_url + "\n",
        )
    elif env.get("SF_ACCESS_TOKEN"):
        _, instance = require("SF_ACCESS_TOKEN", "SF_INSTANCE_URL")
        run(
            [
                "sf",
                "org",
                "login",
                "access-token",
                "--instance-url",
                instance,
                "--no-prompt",
                "--set-default",
            ]
        )
    elif any(env.get(k) for k in ("SF_CLIENT_ID", "SF_USERNAME", "SF_JWT_KEY_FILE")):
        client, username, key = require(
            "SF_CLIENT_ID", "SF_USERNAME", "SF_JWT_KEY_FILE"
        )
        argv = [
            "sf",
            "org",
            "login",
            "jwt",
            "--client-id",
            client,
            "--username",
            username,
            "--jwt-key-file",
            key,
            "--set-default",
        ]
        if env.get("SF_INSTANCE_URL"):
            argv += ["--instance-url", env["SF_INSTANCE_URL"]]
        run(argv)
    else:
        msg = "Provide SF_AUTH_URL, SF_ACCESS_TOKEN and SF_INSTANCE_URL, or JWT inputs"
        raise ValueError(msg)


def _login_github(interactive: bool) -> None:
    """Initialize the explicit github session in private state."""
    env = os.environ
    token = env.get("GH_TOKEN") or env.get("GITHUB_TOKEN")
    if token:
        run(["gh", "api", "user", "--silent"])
        child_env = {
            key: value
            for key, value in env.items()
            if key not in {"GH_TOKEN", "GITHUB_TOKEN"}
        }
        argv = ["gh", "auth", "login", "--with-token"]
        if env.get("GH_HOST"):
            argv += ["--hostname", env["GH_HOST"]]
        run(argv, stdin_text=token + "\n", environment=child_env)
    elif interactive:
        run(["gh", "auth", "login", "--web"], interactive=True)
    else:
        msg = "Provide GH_TOKEN or GITHUB_TOKEN, or use explicit login"
        raise ValueError(msg)


def _login_gitlab(interactive: bool) -> None:
    """Initialize the explicit gitlab session in private state."""
    env = os.environ
    if env.get("GITLAB_TOKEN"):
        host = env.get("GITLAB_HOST", "gitlab.com")
        run(["glab", "api", "user", "--hostname", host])
        child_env = {key: value for key, value in env.items() if key != "GITLAB_TOKEN"}
        run(
            [
                "glab",
                "auth",
                "login",
                "--hostname",
                host,
                "--stdin",
                "--insecure-storage",
            ],
            stdin_text=env["GITLAB_TOKEN"] + "\n",
            environment=child_env,
        )
    elif interactive:
        run(["glab", "auth", "login"], interactive=True)
    else:
        require("GITLAB_TOKEN")


def _login_aws(interactive: bool) -> None:
    """Initialize the explicit aws session in private state."""
    env = os.environ
    if env.get("AWS_ACCESS_KEY_ID") or env.get("AWS_SECRET_ACCESS_KEY"):
        require("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY")
        run(["aws", "sts", "get-caller-identity"])
    elif interactive:
        run(
            ["aws", "sso", "login", "--no-browser", "--use-device-code"],
            interactive=True,
        )
    else:
        run(["aws", "sts", "get-caller-identity"])


def _login_gcloud(interactive: bool) -> None:
    """Initialize the explicit gcloud session in private state."""
    env = os.environ
    if env.get("GOOGLE_APPLICATION_CREDENTIALS"):
        run(
            [
                "gcloud",
                "auth",
                "activate-service-account",
                "--key-file",
                env["GOOGLE_APPLICATION_CREDENTIALS"],
                "--quiet",
            ]
        )
    elif interactive:
        run(["gcloud", "auth", "login", "--no-launch-browser"], interactive=True)
    else:
        msg = "Mount portable gcloud state or set GOOGLE_APPLICATION_CREDENTIALS"
        raise ValueError(msg)


def login(service: str, *, interactive: bool) -> None:
    """Initialize only the requested vendor session."""
    handlers = {
        "azure": _login_azure,
        "salesforce": _login_salesforce,
        "github": _login_github,
        "gitlab": _login_gitlab,
        "aws": _login_aws,
        "gcloud": _login_gcloud,
    }
    handler = handlers.get(service)
    if handler is None:
        msg = "Unsupported login service; use github, gitlab, aws, azure, salesforce, or gcloud"
        raise ValueError(msg)
    handler(interactive)
    print(
        "Authentication completed; scoped authorization is a separate acceptance gate."
    )


if __name__ == "__main__":
    os.umask(0o077)
    try:
        login(sys.argv[1], interactive="--noninteractive" not in sys.argv[2:])
    except (ValueError, OSError):
        # Print only controlled messages, never raw vendor errors or input values.
        error = sys.exc_info()[1]
        print(
            str(error)
            if isinstance(error, ValueError)
            else "Authentication executable unavailable",
            file=sys.stderr,
        )
        sys.exit(1)
