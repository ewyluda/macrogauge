import json

import pytest

from pipeline import dc_basket, dc_longlead, registry


def _figure(**overrides):
    raw = {"metric": "Backlog", "kind": "backlog", "basis": "rpo",
           "scope": "group", "value": 176.0, "unit": "usd_b",
           "period": "2026-06-30", "asof": "2026-07-23",
           "quote": "With a backlog of $176 billion...",
           "src": ["Q2 2026 8-K", "https://example.test/8k"]}
    raw.update(overrides)
    return raw


def _write(tmp_path, packages=None, vendors=None, teaser=None, top=None):
    raw = {
        "schema_version": 1,
        "as_of_curated": "2026-07-27",
        "packages": packages if packages is not None else [
            {"code": "switchgear", "vendors": ["gev"], "null_note": None},
            {"code": "pumps", "vendors": [], "null_note": "No roster vendor."},
        ],
        "vendors": vendors if vendors is not None else {
            "gev": {"name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
                    "dc_segment": "Electrification", "cadence": "quarterly",
                    "figures": [_figure()], "null_note": None},
        },
        "teaser": teaser if teaser is not None else ["gev:backlog"],
    }
    raw.update(top or {})
    p = tmp_path / "dc_longlead.json"
    p.write_text(json.dumps(raw))
    return p


def test_load_happy_path(tmp_path):
    cfg = dc_longlead.load(_write(tmp_path),
                           build_codes={"switchgear", "pumps"})
    assert cfg.as_of_curated == "2026-07-27"
    assert [p.code for p in cfg.packages] == ["switchgear", "pumps"]
    assert cfg.packages[0].vendor_keys == ("gev",)
    assert cfg.packages[1].null_note == "No roster vendor."
    fig = cfg.vendors["gev"].figures[0]
    assert (fig.kind, fig.basis, fig.scope) == ("backlog", "rpo", "group")
    assert fig.value == 176.0 and fig.src_url == "https://example.test/8k"
    assert cfg.teaser == (("gev", "backlog"),)


def test_load_without_build_codes_skips_membership_check(tmp_path):
    # publisher tests and ad-hoc loads may not have a registry at hand
    cfg = dc_longlead.load(_write(tmp_path))
    assert [p.code for p in cfg.packages] == ["switchgear", "pumps"]


def test_load_real_config():
    _, series = registry.load_registry()
    _, baskets = dc_basket.load_baskets(registry_codes={s.code for s in series})
    cfg = dc_longlead.load(build_codes={c.code for c in baskets["build"]})
    # the five long-lead packages, weight-descending (spec §4)
    assert [p.code for p in cfg.packages] == [
        "switchgear", "transformers", "hvac_equip", "generators", "pumps"]
    assert cfg.teaser  # the /datacenter strip has curated picks
    # every figure carries its receipt
    for vendor in cfg.vendors.values():
        for f in vendor.figures:
            assert f.quote and f.src_url.startswith("https://")
    # the two spec-mandated nulls exist
    assert cfg.vendors["cmi"].null_note and not cfg.vendors["cmi"].figures
    pumps = next(p for p in cfg.packages if p.code == "pumps")
    assert pumps.null_note and not pumps.vendor_keys


@pytest.mark.parametrize("mutate,match", [
    (lambda t: _write(t, top={"schema_version": 2}), "schema_version"),
    (lambda t: _write(t, top={"as_of_curated": "27-07-2026"}), "ISO date"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "monthly",
        "figures": [_figure()], "null_note": None}}), "cadence"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure()], "null_note": None}}), "non-empty"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure(kind="bookings")], "null_note": None}}), "kind"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure(basis="press")], "null_note": None}}), "basis"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure(scope="global")], "null_note": None}}), "scope"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure(unit="usd_m")], "null_note": None}}), "unit"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure(value="big")], "null_note": None}}), "numeric"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure(value=True)], "null_note": None}}), "numeric"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure(period="Q2 2026")], "null_note": None}}), "ISO date"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure(quote="")], "null_note": None}}), "non-empty"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure(src=["8-K", "http://insecure.test"])],
        "null_note": None}}), "https"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure(src=["justalabel"])], "null_note": None}}),
     r"\[label, url\]"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [_figure()], "null_note": "also a note"}}), "exactly one"),
    (lambda t: _write(t, vendors={"gev": {
        "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
        "dc_segment": "Electrification", "cadence": "quarterly",
        "figures": [], "null_note": None}}), "exactly one"),
    (lambda t: _write(t, packages=[
        {"code": "switchgear", "vendors": ["ghost"], "null_note": None}]),
     "unknown vendor"),
    (lambda t: _write(t, packages=[
        {"code": "switchgear", "vendors": ["gev"], "null_note": None},
        {"code": "switchgear", "vendors": ["gev"], "null_note": None}]),
     "duplicate"),
    (lambda t: _write(t, packages=[
        {"code": "switchgear", "vendors": [], "null_note": None}]),
     "exactly one"),
    (lambda t: _write(t, packages=[
        {"code": "pumps", "vendors": [], "null_note": "No roster vendor."}]),
     "unreferenced"),
    (lambda t: _write(t, teaser=["gev-backlog"]), "vendor_key:kind"),
    (lambda t: _write(t, teaser=["gev:orders"]), "no 'orders' figure"),
    (lambda t: _write(t, teaser=["ghost:backlog"]), "unknown vendor"),
])
def test_garbled_config_rejected(tmp_path, mutate, match):
    with pytest.raises(ValueError, match=match):
        dc_longlead.load(mutate(tmp_path), build_codes={"switchgear", "pumps"})


def test_membership_check_rejects_non_build_code(tmp_path):
    with pytest.raises(ValueError, match="not a Build component code"):
        dc_longlead.load(_write(tmp_path), build_codes={"transformers"})
