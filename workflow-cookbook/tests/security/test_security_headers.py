import asyncio
from typing import Any, Dict, List, Tuple

import pytest


pytestmark = pytest.mark.security_headers


Headers = List[Tuple[bytes, bytes]]


async def call_app(app: Any) -> Headers:
    scope: Dict[str, Any] = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "path": "/",
        "headers": [],
    }
    messages: Headers = []

    async def send(message: Dict[str, Any]) -> None:
        if message["type"] == "http.response.start":
            messages.extend(message.get("headers", []))

    async def receive() -> Dict[str, Any]:
        return {"type": "http.request"}

    await app(scope, receive, send)
    return messages


async def bare_app(scope: Dict[str, Any], receive: Any, send: Any) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": 200,
            "headers": [(b"content-type", b"text/plain")],
        }
    )
    await send({"type": "http.response.body", "body": b"ok"})


def get_header(headers: Headers, name: str) -> str | None:
    lower = name.encode().lower()
    for header_name, header_value in headers:
        if header_name.lower() == lower:
            return header_value.decode()
    return None


def test_security_headers_added() -> None:
    from security_headers.middleware import SecurityHeadersConfig, SecurityHeadersMiddleware

    middleware = SecurityHeadersMiddleware(
        bare_app,
        SecurityHeadersConfig(
            strict_transport_security="max-age=63072000; includeSubDomains",
            content_security_policy="default-src 'self'",
            referrer_policy="strict-origin-when-cross-origin",
        ),
    )

    headers = asyncio.run(call_app(middleware))

    assert get_header(headers, "Strict-Transport-Security") == "max-age=63072000; includeSubDomains"
    assert get_header(headers, "X-Content-Type-Options") == "nosniff"
    assert get_header(headers, "Content-Security-Policy") == "default-src 'self'"
    assert get_header(headers, "Referrer-Policy") == "strict-origin-when-cross-origin"


def test_security_headers_not_added_without_middleware() -> None:
    headers = asyncio.run(call_app(bare_app))

    assert get_header(headers, "Strict-Transport-Security") is None
    assert get_header(headers, "X-Content-Type-Options") is None
    assert get_header(headers, "Content-Security-Policy") is None
    assert get_header(headers, "Referrer-Policy") is None
