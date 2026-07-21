"""Shared connector helpers."""
import warnings

from pipeline.dates import month_first  # noqa: F401 — re-export; connectors import from here


class PartialFetchWarning(UserWarning):
    """A connector tolerated per-item failures and returned a partial batch.

    collect_all records the message (sanitized) in SourceResult.error while
    keeping ok=True — partial success must not read as a broken source, but
    the tolerated errors must not vanish either (they used to surface only
    via per-series staleness QA, up to max_staleness_days later)."""


def warn_partial(source: str, errors: list[tuple[str, Exception]]) -> None:
    """Emit the partial-failure detail for collect_all to publish."""
    if errors:
        warnings.warn(
            f"{source}: {len(errors)} item(s) failed — " + "; ".join(
                f"{item}: {type(e).__name__}: {e}" for item, e in errors),
            PartialFetchWarning, stacklevel=2)


def get_text(url: str, http_get) -> str:
    resp = http_get(url, timeout=60)
    resp.raise_for_status()
    return resp.text


def get_bytes(url: str, http_get) -> bytes:
    resp = http_get(url, timeout=60)
    resp.raise_for_status()
    return resp.content
