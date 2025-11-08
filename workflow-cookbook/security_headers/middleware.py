from __future__ import annotations

from dataclasses import dataclass, field
from typing import Awaitable, Callable, Dict, Iterable, Mapping, MutableMapping, Tuple

ASGIApp = Callable[[Dict[str, object], Callable[[], Awaitable[Dict[str, object]]], Callable[[Dict[str, object]], Awaitable[None]]], Awaitable[None]]
SendCallable = Callable[[Dict[str, object]], Awaitable[None]]
ReceiveCallable = Callable[[], Awaitable[Dict[str, object]]]
Scope = Dict[str, object]
Message = Dict[str, object]
HeaderTuple = Tuple[bytes, bytes]


@dataclass(frozen=True)
class SecurityHeadersConfig:
    strict_transport_security: str | None = None
    content_security_policy: str | None = None
    referrer_policy: str | None = None
    permissions_policy: str | None = None
    cross_origin_embedder_policy: str | None = None
    cross_origin_opener_policy: str | None = None
    cross_origin_resource_policy: str | None = None
    x_content_type_options: str | None = "nosniff"
    additional_headers: Mapping[str, str] = field(default_factory=dict)

    def iter_headers(self) -> Iterable[tuple[str, str]]:
        if self.strict_transport_security:
            yield "Strict-Transport-Security", self.strict_transport_security
        if self.x_content_type_options:
            yield "X-Content-Type-Options", self.x_content_type_options
        if self.content_security_policy:
            yield "Content-Security-Policy", self.content_security_policy
        if self.referrer_policy:
            yield "Referrer-Policy", self.referrer_policy
        if self.permissions_policy:
            yield "Permissions-Policy", self.permissions_policy
        if self.cross_origin_embedder_policy:
            yield "Cross-Origin-Embedder-Policy", self.cross_origin_embedder_policy
        if self.cross_origin_opener_policy:
            yield "Cross-Origin-Opener-Policy", self.cross_origin_opener_policy
        if self.cross_origin_resource_policy:
            yield "Cross-Origin-Resource-Policy", self.cross_origin_resource_policy
        for name, value in self.additional_headers.items():
            yield name, value


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp, config: SecurityHeadersConfig | None = None) -> None:
        self.app = app
        self.config = config or SecurityHeadersConfig()
        self._prepared_headers = tuple(
            (name.encode("latin-1"), value.encode("latin-1"))
            for name, value in self.config.iter_headers()
        )

    async def __call__(self, scope: Scope, receive: ReceiveCallable, send: SendCallable) -> None:
        async def send_wrapper(message: Message) -> None:
            if message.get("type") == "http.response.start":
                headers: list[HeaderTuple] = list(message.get("headers", []))
                header_map: MutableMapping[bytes, HeaderTuple] = {
                    key.lower(): (key, value) for key, value in headers
                }
                for name, value in self._prepared_headers:
                    header_map[name.lower()] = (name, value)
                message["headers"] = list(header_map.values())
            await send(message)

        await self.app(scope, receive, send_wrapper)


__all__ = ["SecurityHeadersConfig", "SecurityHeadersMiddleware"]
