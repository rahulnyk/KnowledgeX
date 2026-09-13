"""End-to-end checks for kx. Run with: python tests/test_kx.py  (pytest also works)."""
import contextlib
import importlib.util
import io
import os
import sys
import tempfile
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from knowledgex import bundle as kb  # noqa: E402
from knowledgex.cli import main  # noqa: E402

AGENT = "test-agent/1.0"


def kx(*args):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        try:
            code = main(list(args))
        except SystemExit as exc:
            code = exc.code if isinstance(exc.code, int) else 1
    return code, out.getvalue()


def test_helpers():
    assert kb.slugify("Café — Q3 Plan!") == "cafe-q3-plan"
    assert kb.add_months(date(2024, 1, 31), 1) == date(2024, 2, 29)
    meta = {
        "generated": {"by": AGENT, "at": "2026-01-02T00:00:00Z"},
        "verified": [{"by": "human:alex", "at": "2026-01-01T00:00:00Z"}],
    }
    assert kb.trust(meta) == "unverified"  # content changed after the human check
    meta["verified"].append({"by": AGENT, "at": "2026-01-03T00:00:00Z"})
    assert kb.trust(meta) == "machine-confirmed"
    assert kb.trust({"verified": {"by": "human:alex", "at": "2026-01-01"}}) == "human-reviewed"


def test_workflow():
    saved = {k: os.environ.get(k) for k in ("XDG_CONFIG_HOME", "KX_BUNDLE")}
    with tempfile.TemporaryDirectory() as tmp:
        os.environ["XDG_CONFIG_HOME"] = str(Path(tmp) / "config")
        os.environ.pop("KX_BUNDLE", None)
        try:
            root = Path(tmp) / "bundle"
            assert kx("init", str(root))[0] == 0
            assert 'okf_version: "0.2"' in (root / "index.md").read_text()

            code, out = kx("new", "Decision", "Use PostgreSQL as the job queue",
                           "--description", "Jobs live in PostgreSQL until volume needs a dedicated queue.", "--by", AGENT)
            old = Path(out.strip())
            assert code == 0 and old.name == "use-postgresql-as-the-job-queue.md"
            assert "stale_after" not in kb.read_note(old).meta  # decisions don't expire
            assert f"generated:\n  by: {AGENT}\n  at: 20" in old.read_text()  # timestamps stay plain strings

            code, out = kx("check")
            assert code == 0 and "template hints" in out  # fresh templates warn but don't fail

            code, out = kx("new", "Entity", "Acme Payments API", "--description", "The payment provider behind checkout.",
                           "--by", AGENT, "--source", "acme-docs=https://docs.example.com")
            entity = Path(out.strip())
            assert kb.read_note(entity).meta["stale_after"].endswith("T00:00:00Z")
            assert kx("verify", entity.name, "--by", "human:alex")[0] == 0
            assert kb.trust(kb.read_note(entity).meta) == "human-reviewed"
            assert kx("verify", entity.name, "--by", "not an actor")[0] != 0

            code, out = kx("new", "Decision", "Use a dedicated job queue",
                           "--description", "Jobs move to a dedicated queue service.", "--by", AGENT)
            new = Path(out.strip())
            assert kx("relate", new.name, "supersedes", old.name, "--by", AGENT)[0] == 0
            assert kb.read_note(old).meta["status"] == "deprecated"
            assert "(use-a-dedicated-job-queue.md)" in old.read_text()
            assert "(use-postgresql-as-the-job-queue.md)" in new.read_text()

            code, out = kx("search", "job", "queue")
            assert new.name in out and old.name not in out
            code, out = kx("search", "postgresql", "--all")
            assert "superseded by: use-a-dedicated-job-queue.md" in out
            assert kx("check")[0] == 0

            (root / "Bad Note.md").write_text("---\ntitle: x\n---\nSee [[Other]]. As we discussed today.\n")
            code, out = kx("check")
            assert code == 1 and "missing `type`" in out and "wikilinks" in out and "chat transcript" in out
            (root / "Bad Note.md").unlink()

            note = kb.read_note(entity)
            note.meta["stale_after"] = "2000-01-01T00:00:00Z"
            kb.write_note(note)
            code, out = kx("review")
            assert "## Stale" in out and entity.name in out
            assert "**Supersession**" in (root / "log.md").read_text()

            skills = Path(tmp) / "skills"
            assert kx("install-skill", str(skills))[0] == 0
            assert (skills / "knowledgex" / "SKILL.md").read_text().startswith("---\nname: knowledgex")
            assert (skills / "knowledgex" / "references" / "what-to-write.md").exists()
        finally:
            for key, value in saved.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value


def test_eval_cases():
    spec = importlib.util.spec_from_file_location("eval_runner", Path(__file__).resolve().parents[1] / "evals" / "run.py")
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    assert runner.check_cases(runner.load_cases()) == []


if __name__ == "__main__":
    test_helpers()
    test_workflow()
    test_eval_cases()
    print("ok")
