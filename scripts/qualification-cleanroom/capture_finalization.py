"""Finalize a private diagnostic attempt without treating missing evidence as a pass."""

from __future__ import annotations

import json
from typing import Any


async def finalize_attempt(
    directory: Any, packet: Any, resources: Any, snapshot: Any
) -> Any:
    """Perform finalize attempt."""
    errors = []

    def record(stage: Any, error: Any) -> Any:
        """Perform record."""
        errors.append(
            {"stage": stage, "errorType": type(error).__name__, "error": str(error)}
        )

    try:
        (directory / "thread-final.private.json").write_text(
            json.dumps(snapshot(), indent=2)
        )
    except Exception as error:  # pylint: disable=broad-exception-caught
        # Each independent cleanup fault is retained; remaining cleanup must run.
        record("snapshot", error)
    for name, resource in resources:
        try:
            resource.close()
        except Exception as error:  # pylint: disable=broad-exception-caught
            # Resource implementations can fail independently; preserve every fault.
            record(name, error)
    receipt = None
    try:
        receipt = await packet.close()
        (directory / "packet-receipt.private.json").write_text(
            json.dumps(receipt, indent=2)
        )
    except Exception as error:  # pylint: disable=broad-exception-caught
        # Packet collector failures must retain an incomplete finalization receipt.
        record("packet", error)
    result = {
        "packet": receipt,
        "errors": errors,
        "complete": not errors
        and receipt is not None
        and receipt.get("complete") is True,
    }
    (directory / "finalization.private.json").write_text(json.dumps(result, indent=2))
    return result
