                      
























from __future__ import annotations

import json
import os
import re
import subprocess
import sys

LABELS_FILE = ".github/hold-labels.txt"

                                                                             
QUEUE_REF = re.compile(r"/pr-(\d+)-[0-9a-f]{6,}$")

                                                                                
SQUASH_SUBJECT = re.compile(r"\(#(\d+)\)\s*$", re.MULTILINE)


def fail(message: str) -> None:
    print(f"::error::{message}")
    sys.exit(1)


def load_hold_labels() -> set[str]:






    try:
        with open(LABELS_FILE, encoding="utf-8") as handle:
            raw = handle.read()
    except OSError as err:
        fail(f"cannot read {LABELS_FILE} ({err}); refusing rather than guessing that nothing is held")

    labels = {
        line.strip().lower()
        for line in raw.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }
    if not labels:
        fail(f"{LABELS_FILE} lists no labels; a gate that can never fire is not a gate")
    return labels


def gh_api(path: str) -> object:

    try:
        out = subprocess.run(
            ["gh", "api", path],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    except subprocess.CalledProcessError as err:
        fail(f"GET {path} failed: {err.stderr.strip()[:400]}")
    try:
        return json.loads(out)
    except json.JSONDecodeError as err:
        fail(f"GET {path} returned something that is not JSON ({err})")


def labels_of(repo: str, number: int) -> list[str]:
    payload = gh_api(f"repos/{repo}/pulls/{number}")
    return [label["name"] for label in payload.get("labels", [])]


def pull_requests_in_merge_group(repo: str) -> list[int]:








    numbers: set[int] = set()

    head_ref = os.environ.get("MERGE_GROUP_HEAD_REF", "")
    if match := QUEUE_REF.search(head_ref):
        numbers.add(int(match.group(1)))

    base_sha = os.environ.get("MERGE_GROUP_BASE_SHA", "")
    head_sha = os.environ.get("MERGE_GROUP_HEAD_SHA", "")
    if base_sha and head_sha:
        compare = gh_api(f"repos/{repo}/compare/{base_sha}...{head_sha}")
        for commit in compare.get("commits", []):
            subject = commit.get("commit", {}).get("message", "").splitlines()[:1]
            if subject and (match := SQUASH_SUBJECT.search(subject[0])):
                numbers.add(int(match.group(1)))

    if not numbers:
        fail(
            "could not work out which pull requests this merge group contains "
            f"(head_ref={head_ref!r}, base={base_sha!r}, head={head_sha!r}); "
            "refusing rather than merging a batch whose labels were never read"
        )
    return sorted(numbers)


def main() -> None:
    hold_labels = load_hold_labels()
    repo = os.environ["REPO"]
    event = os.environ.get("EVENT_NAME", "")

    if event == "pull_request":
        number = os.environ.get("PR_NUMBER", "")
        if not number.isdigit():
            fail(f"no pull request number on a {event} event (got {number!r})")
        candidates = [int(number)]
    elif event == "merge_group":
        candidates = pull_requests_in_merge_group(repo)
    else:
        fail(f"unexpected event {event!r}; this gate only knows pull_request and merge_group")

    held: list[str] = []
    for number in candidates:
        names = labels_of(repo, number)
        blocking = sorted(name for name in names if name.lower() in hold_labels)
        shown = ", ".join(names) if names else "(none)"
        if blocking:
            held.append(f"#{number} carries {', '.join(blocking)}")
            print(f"HELD    #{number}: labels = {shown}")
        else:
            print(f"clear   #{number}: labels = {shown}")

    if held:
        fail(
            "refusing to merge — " + "; ".join(held) + ". "
            "Remove the label when the thing it is waiting for has happened. "
            "This check is what makes the label mean something on every merge "
            "path, including the queue and the web Merge button."
        )

    print(f"\nNo hold labels on {', '.join('#' + str(n) for n in candidates)} — clear to merge.")


if __name__ == "__main__":
    main()
