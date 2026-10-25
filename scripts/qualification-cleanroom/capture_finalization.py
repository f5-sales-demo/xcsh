"""Finalize a private diagnostic attempt without treating missing evidence as a pass."""
import json


async def finalize_attempt(directory, packet, resources, snapshot):
    errors = []

    def record(stage, error):
        errors.append({"stage": stage, "errorType": type(error).__name__, "error": str(error)})

    try:
        (directory / "thread-final.private.json").write_text(json.dumps(snapshot(), indent=2))
    except Exception as error:
        record("snapshot", error)
    for name, resource in resources:
        try:
            resource.close()
        except Exception as error:
            record(name, error)
    receipt = None
    try:
        receipt = await packet.close()
        (directory / "packet-receipt.private.json").write_text(json.dumps(receipt, indent=2))
    except Exception as error:
        record("packet", error)
    result = {"packet": receipt, "errors": errors,
              "complete": not errors and receipt is not None and receipt.get("complete") is True}
    (directory / "finalization.private.json").write_text(json.dumps(result, indent=2))
    return result
