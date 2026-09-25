"""Read-only public smoke check. No login, credentials, data writes or deploy."""
import argparse
import concurrent.futures
import datetime
import hashlib
import json
import urllib.error
import urllib.request
from pathlib import Path

ORIGIN = "https://wmgj-ops.web.app"
EXPECTED_VERSION = "1.5.4"
CASES = [
    ("homepage", "/", 200, {}),
    ("institutional_portal", "/portal", 200, {}),
    ("anonymous_session_denied", "/api/portal/session", 401, {}),
    ("anonymous_batches_denied", "/api/portal/batches", 401, {}),
    ("foreign_origin_denied", "/api/portal/session", 403,
     {"Origin": "https://unauthorized.example"}),
]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def check(case):
    name, path, expected, headers = case
    item = {"id": name, "method": "GET", "path": path, "expectedStatus": expected}
    try:
        request = urllib.request.Request(ORIGIN + path, headers=headers, method="GET")
        try:
            response = urllib.request.build_opener(NoRedirect()).open(request, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            payload = response.read(2_000_001)
            content_type = response.headers.get("Content-Type", "")
            cache = response.headers.get("Cache-Control", "")
            item.update(status=response.code, cacheControl=cache,
                        contentType=content_type, bytes=len(payload),
                        responseSha256=hashlib.sha256(payload).hexdigest())
            checks = {"status": response.code == expected,
                      "boundedResponse": len(payload) <= 2_000_000,
                      "noStore": "no-store" in cache.lower()}
            if expected == 200:
                checks.update(html="text/html" in content_type,
                              brand=b"AURORA NEXUS" in payload,
                              version=EXPECTED_VERSION.encode() in payload)
            else:
                checks["json"] = "application/json" in content_type
                try:
                    body = json.loads(payload)
                    checks["noReceipts"] = isinstance(body, dict) and "receipts" not in body
                except (ValueError, TypeError):
                    checks["noReceipts"] = False
            item.update(checks=checks, passed=all(checks.values()))
    except Exception as error:
        # Log the exception class only: no response body, cookies, tokens or credentials.
        item.update(passed=False, errorType=type(error).__name__)
    return item


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        results = list(executor.map(check, CASES))
    report = {"scope": "public_read_only_smoke", "origin": ORIGIN,
              "expectedVersion": EXPECTED_VERSION,
              "checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "cases": results, "passed": sum(r["passed"] for r in results),
              "total": len(results), "fullHomologation": False,
              "limitations": ["No authenticated session", "No MFA test",
                              "No ingestion or tenant-isolation test",
                              "No source-to-deployment equivalence established"]}
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"passed": report["passed"], "total": report["total"],
                      "fullHomologation": False}))
    return 0 if report["passed"] == report["total"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
