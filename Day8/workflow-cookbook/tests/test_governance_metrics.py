"""governance.metrics.yaml の内容を検証するテスト。"""

from pathlib import Path
from typing import Dict

try:
    import yaml
except ModuleNotFoundError:  # pragma: no cover - fallback for minimal env
    class _MiniYamlModule:
        @staticmethod
        def safe_load(content: str) -> Dict[str, str]:
            result: Dict[str, str] = {}
            for line in content.splitlines():
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                key, _, value = stripped.partition(":")
                result[key.strip()] = value.strip()
            return result

    yaml = _MiniYamlModule()  # type: ignore[assignment]


def test_governance_metrics_contains_required_keys() -> None:
    metrics_path = Path("governance/metrics.yaml")
    metrics_data = yaml.safe_load(metrics_path.read_text(encoding="utf-8"))

    assert isinstance(metrics_data, dict)
    for key in ("compress_ratio", "semantic_retention"):
        assert key in metrics_data, f"Missing metric: {key}"
