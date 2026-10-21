"""Pure, dependency-free helpers used by the SmartBasket add-ons.

Keeping these separate makes security/price logic easy to unit test.
"""
from __future__ import annotations
import base64
import hashlib
import hmac
import math
import struct
import time
import unicodedata


def normalize_list_name(value: str) -> str:
    """Case/space-insensitive canonical key for *one owner's* list names."""
    if not isinstance(value, str):
        raise ValueError('List name must be text.')
    return ' '.join(unicodedata.normalize('NFKC', value).split()).casefold()


def clean_list_name(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError('Please name the basket.')
    cleaned = ' '.join(unicodedata.normalize('NFKC', value).split())
    if not cleaned:
        raise ValueError('Please name the basket.')
    if len(cleaned) > 100:
        raise ValueError('List names must be 100 characters or fewer.')
    return cleaned


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def totp_valid(secret: str, supplied: str, *, now: int | None = None, window: int = 1) -> bool:
    """RFC 6238 HMAC-SHA1 TOTP, 30-second window, six digits.

    The base32 secret belongs in the Railway environment, never in frontend code.
    """
    if not secret or not isinstance(supplied, str) or len(supplied.strip()) != 6 or not supplied.strip().isdigit():
        return False
    try:
        normalized = ''.join(secret.upper().split())
        key = base64.b32decode(normalized + '=' * (-len(normalized) % 8), casefold=True)
        if len(key) < 10:
            return False
    except (ValueError, base64.binascii.Error):
        return False
    counter = int(time.time() if now is None else now) // 30
    for step in range(-window, window + 1):
        message = struct.pack('>Q', counter + step)
        digest = hmac.new(key, message, hashlib.sha1).digest()
        offset = digest[-1] & 15
        number = (struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7fffffff) % 1000000
        if hmac.compare_digest(f'{number:06d}', supplied.strip()):
            return True
    return False


def watch_price_triggered(previous: float | None, current: float, target: float | None, last_notified: float | None) -> bool:
    """Only a real decrease can trigger a watch; target is an optional ceiling."""
    try:
        current = float(current)
        if not math.isfinite(current) or current <= 0:
            return False
        if previous is None or not math.isfinite(float(previous)) or current >= float(previous):
            return False
        if target is not None and current > float(target):
            return False
        if last_notified is not None and current >= float(last_notified):
            return False
    except (ValueError, TypeError, OverflowError):
        return False
    return True
