from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import IO, Any, Mapping, Sequence

JsonMapping = Mapping[str, Any]


def _utc_timestamp(value: datetime | None) -> str:
    if value is None:
        value = datetime.now(timezone.utc)
    elif value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat()


def _to_jsonable(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_jsonable(item) for item in value]
    return value


@dataclass(slots=True)
class InferenceLogRecord:
    logger: str
    event: str
    level: str
    timestamp: str
    inference_id: str | None = None
    model: str | None = None
    prompt: JsonMapping | None = None
    response: JsonMapping | None = None
    metrics: JsonMapping | None = None
    tags: Sequence[str] | None = None
    extra: JsonMapping | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "logger": self.logger,
            "event": self.event,
            "level": self.level,
            "timestamp": self.timestamp,
            "inference_id": self.inference_id,
            "model": self.model,
            "prompt": _to_jsonable(self.prompt) if self.prompt is not None else None,
            "response": _to_jsonable(self.response) if self.response is not None else None,
            "metrics": _to_jsonable(self.metrics) if self.metrics is not None else {},
            "tags": list(self.tags) if self.tags is not None else [],
            "extra": _to_jsonable(self.extra) if self.extra is not None else {},
        }


class StructuredLogger:
    __slots__ = ("_name", "_path", "_stream")

    def __init__(self, *, name: str, path: str | Path | None = None, stream: IO[str] | None = None) -> None:
        if path is None and stream is None:
            raise ValueError("Either path or stream must be provided")
        self._name = name
        self._path = Path(path).expanduser() if path is not None else None
        self._stream = stream

    @property
    def name(self) -> str:
        return self._name

    def inference(
        self,
        *,
        inference_id: str | None = None,
        model: str | None = None,
        prompt: JsonMapping | None = None,
        response: JsonMapping | None = None,
        metrics: JsonMapping | None = None,
        tags: Sequence[str] | None = None,
        extra: JsonMapping | None = None,
        level: str = "INFO",
        timestamp: datetime | None = None,
    ) -> None:
        record = InferenceLogRecord(
            logger=self._name,
            event="inference",
            level=level,
            timestamp=_utc_timestamp(timestamp),
            inference_id=inference_id,
            model=model,
            prompt=prompt,
            response=response,
            metrics=metrics,
            tags=tuple(tags) if tags is not None else None,
            extra=extra,
        )
        self._write(record)

    def _write(self, record: InferenceLogRecord) -> None:
        line = json.dumps(record.to_dict(), ensure_ascii=False) + "\n"
        if self._stream is not None:
            self._stream.write(line)
            self._stream.flush()
        else:
            assert self._path is not None
            self._path.parent.mkdir(parents=True, exist_ok=True)
            with self._path.open("a", encoding="utf-8") as handle:
                handle.write(line)


__all__ = ["InferenceLogRecord", "StructuredLogger"]
