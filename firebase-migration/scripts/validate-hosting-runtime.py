#!/usr/bin/env python3
"""Read-only gate: every Hosting function must exist in its configured region.

Planned functions are only those explicitly selected by the following deploy;
they never waive requirements for other routes. No cloud calls or credentials.
"""
import argparse
import json
import sys


def validate(config, inventory, planned=(), required=()):
    if not isinstance(inventory, dict) or inventory.get("status") == "error":
        raise ValueError("FUNCTION_INVENTORY_INVALID")
    entries = inventory.get("result", inventory.get("functions"))
    if not isinstance(entries, list):
        raise ValueError("FUNCTION_INVENTORY_INVALID")
    deployed = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("FUNCTION_INVENTORY_INVALID")
        name = entry.get("id") or entry.get("name")
        region = entry.get("region")
        if not isinstance(name, str) or not isinstance(region, str):
            raise ValueError("FUNCTION_ID_OR_REGION_MISSING")
        state = entry.get("state", "ACTIVE")
        if state == "ACTIVE":
            deployed.add((name.rsplit("/", 1)[-1], region))
    hosting = config["hosting"]
    sites = hosting if isinstance(hosting, list) else [hosting]
    targets = set()
    for site in sites:
        for rewrite in site.get("rewrites", []):
            function = rewrite.get("function")
            if function is None:
                continue
            if not isinstance(function, dict) or not function.get("functionId") or not function.get("region"):
                raise ValueError("HOSTING_FUNCTION_REQUIRES_EXPLICIT_REGION")
            targets.add((function["functionId"], function["region"]))
    if not targets:
        raise ValueError("HOSTING_FUNCTION_TARGETS_EMPTY")
    targets.update((name, "southamerica-east1") for name in required)
    planned_set = set(planned)
    if not planned_set.issubset({name for name, _ in targets}):
        raise ValueError("PLANNED_FUNCTION_NOT_IN_CONTRACT")
    missing = sorted(f"{name}@{region}" for name, region in targets
                     if (name, region) not in deployed and name not in planned_set)
    return {"ok": not missing, "gate": "HOSTING_RUNTIME_DEPENDENCIES",
            "missing": missing, "checked": len(targets), "planned": sorted(planned_set)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="firebase.json")
    parser.add_argument("--inventory", required=True)
    parser.add_argument("--planned", default="")
    parser.add_argument("--require", default="")
    args = parser.parse_args()
    try:
        with open(args.config, encoding="utf-8") as stream:
            config = json.load(stream)
        with open(args.inventory, encoding="utf-8") as stream:
            inventory = json.load(stream)
        result = validate(config, inventory, filter(None, args.planned.split(",")),
                          filter(None, args.require.split(",")))
        print(json.dumps(result, sort_keys=True))
        if not result["ok"]:
            print("HML_RUNTIME_INCOMPLETE: complete the protected full HML deploy before retrying ingestion.", file=sys.stderr)
        return 0 if result["ok"] else 1
    except (ValueError, KeyError, TypeError, OSError):
        print(json.dumps({"ok": False, "gate": "HOSTING_RUNTIME_DEPENDENCIES", "code": "INVALID_INPUT"}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
