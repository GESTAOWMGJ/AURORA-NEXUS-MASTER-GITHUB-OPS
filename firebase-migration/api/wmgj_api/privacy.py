import re
from collections.abc import Mapping, Sequence


DIRECT_IDENTIFIER = re.compile(
    r"(?:\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{15}\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})",
    re.IGNORECASE,
)


def contains_direct_identifier(value: object) -> bool:
    if isinstance(value, str):
        return DIRECT_IDENTIFIER.search(value) is not None
    if isinstance(value, Mapping):
        return any(contains_direct_identifier(item) for item in value.values())
    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        return any(contains_direct_identifier(item) for item in value)
    return False
