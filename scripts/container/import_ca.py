"""Import each supplied PEM trust anchor into Chromium's private NSS store."""

import hashlib
import os
import re
import subprocess
import tempfile
from pathlib import Path

certificate_bytes = Path("/imports/ca.pem").read_bytes()
BUNDLE_DIGEST = hashlib.sha256(certificate_bytes).hexdigest()
stamp = Path(os.environ["HOME"]) / ".xcsh" / "nss-ca.sha256"
if stamp.exists() and stamp.read_text().strip() == BUNDLE_DIGEST:
    raise SystemExit(0)

for index, certificate in enumerate(
    re.findall(
        r"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----",
        Path("/imports/ca.pem").read_text(),
        re.DOTALL,
    )
):
    with tempfile.NamedTemporaryFile(mode="w", suffix=".pem") as pem:
        pem.write(certificate + "\n")
        pem.flush()
        subprocess.run(  # noqa: S603 - fixed certutil operation; PEM path is task-owned.
            [
                "/usr/bin/certutil",
                "-A",
                "-d",
                "sql:" + os.environ["HOME"] + "/.pki/nssdb",
                "-n",
                "xcsh-additional-" + str(index),
                "-t",
                "C,,",
                "-i",
                pem.name,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

stamp.write_text(BUNDLE_DIGEST + "\n")
