"""Ops hardening (backlog #13), pinned as text so a workflow edit can't
silently regress it: every action pinned to a full commit SHA (with the
release in a comment), no persisted checkout credential, and the daily
push token visible to exactly one step — the one that pushes."""
import re
from pathlib import Path

WORKFLOWS = Path(__file__).parent.parent / ".github" / "workflows"
USES = re.compile(r"^\s*-?\s*uses:\s*(\S+)(.*)$")


def _files():
    files = sorted(WORKFLOWS.glob("*.yml"))
    assert {f.name for f in files} >= {"daily.yml", "ci.yml", "watchdog.yml"}
    return files


def test_every_action_is_pinned_to_a_full_sha_with_its_version():
    for f in _files():
        for line in f.read_text().splitlines():
            m = USES.match(line)
            if not m:
                continue
            ref, comment = m[1], m[2]
            assert re.fullmatch(r"[\w.-]+/[\w.-]+@[0-9a-f]{40}", ref), f"{f.name}: {line.strip()}"
            assert re.search(r"#\s*v\d+\.\d+\.\d+", comment), f"{f.name}: no version comment: {line.strip()}"


def test_checkout_never_persists_credentials():
    for f in _files():
        lines = f.read_text().splitlines()
        for i, line in enumerate(lines):
            if "uses: actions/checkout@" not in line:
                continue
            block = []
            for nxt in lines[i + 1:]:
                if re.match(r"^\s*-\s", nxt):
                    break
                block.append(nxt)
            assert any(re.match(r"^\s*persist-credentials:\s*false\s*$", b) for b in block), \
                f"{f.name}: checkout without persist-credentials: false"


def _steps(text):
    """Split a workflow into its step blocks (text from one '- ' step marker
    at the steps indent to the next)."""
    lines = text.splitlines()
    start = next(i for i, l in enumerate(lines) if l.strip() == "steps:")
    indent = None
    steps, cur = [], []
    for l in lines[start + 1:]:
        m = re.match(r"^(\s*)- ", l)
        if m and (indent is None or len(m[1]) == indent):
            indent = len(m[1])
            if cur:
                steps.append("\n".join(cur))
            cur = [l]
        elif cur:
            cur.append(l)
    if cur:
        steps.append("\n".join(cur))
    return steps


def test_daily_push_token_reaches_only_the_commit_step():
    text = (WORKFLOWS / "daily.yml").read_text()
    with_token = [s for s in _steps(text) if "github.token" in s or "secrets.GITHUB_TOKEN" in s]
    assert len(with_token) == 1 and "name: Commit data back" in with_token[0]
    commit = with_token[0]
    # the credential rides per-command (-c), never into .git/config
    assert "git config" not in re.sub(r"git config user\.(name|email)", "", commit)
    assert "authgit push origin HEAD:main" in commit
    assert "authgit pull --rebase origin main" in commit
