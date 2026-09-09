#!/usr/bin/env python3
"""Start merge-request pipelines for contributor MRs that would otherwise never get one.

On gitlab.com a merge request from a fork runs its pipeline in the *fork*, on the fork
owner's runner minutes — and most contributors have never enabled shared runners there
(it needs identity verification), so their MR sits at "no pipeline" forever. A maintainer
can press "Run pipeline" on the MR page to run it in this project instead; this script
presses that button for them, with the same care a maintainer would take:

  * only for authors who are already trusted — project members, or people with at
    least one merged MR here (the GitHub "first-time contributor" rule). Everyone else
    gets the `ci-approval-needed` label so a maintainer can find and start them by hand.
  * never when the MR touches `.gitlab-ci.yml`: the pipeline runs with this project's
    job token, and a changed pipeline definition is exactly where that token could be
    misused. Same label, a maintainer reads the diff first.
  * never twice for the same commit, never for drafts, and at most MAX_TRIGGERS per run.

Runs from the `mr:fork-pipelines` job (scheduled, and after every push to main). Needs
PIPELINE_API_TOKEN — a token with `api` scope and at least Developer on the project.
"""
import json
import os
import sys
import urllib.parse
import urllib.request

API = os.environ["CI_API_V4_URL"]
PROJECT = os.environ["CI_PROJECT_ID"]
TOKEN = os.environ["PIPELINE_API_TOKEN"]
MAX_TRIGGERS = int(os.environ.get("FORK_MR_MAX_TRIGGERS", "8"))
LABEL = "ci-approval-needed"
DRY_RUN = "--dry-run" in sys.argv


def call(method, path, body=None, params=None):
    url = f"{API}/projects/{PROJECT}/{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("PRIVATE-TOKEN", TOKEN)
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def paged(path, **params):
    page = 1
    while True:
        batch = call("GET", path, params={**params, "per_page": 100, "page": page})
        if not batch:
            return
        yield from batch
        if len(batch) < 100:
            return
        page += 1


def trusted_authors():
    members = {m["username"] for m in paged("members/all") if m["access_level"] >= 30}
    merged = {m["author"]["username"] for m in paged("merge_requests", state="merged")}
    return members | merged


def ensure_label():
    if any(l["name"] == LABEL for l in paged("labels")):
        return
    if not DRY_RUN:
        call("POST", "labels", {"name": LABEL, "color": "#ed9121",
             "description": "Fork MR whose pipeline a maintainer has to start by hand"})


def set_label(mr, present):
    has = LABEL in mr["labels"]
    if has == present or DRY_RUN:
        return
    key = "add_labels" if present else "remove_labels"
    call("PUT", f"merge_requests/{mr['iid']}", {key: LABEL})


def main():
    trusted = trusted_authors()
    ensure_label()
    triggered = 0
    for mr in paged("merge_requests", state="opened", order_by="updated_at"):
        iid, author, sha = mr["iid"], mr["author"]["username"], mr["sha"]
        tag = f"!{iid} ({author}, {mr['source_branch']})"
        if mr["source_project_id"] == mr["target_project_id"]:
            continue  # same-project branch: gets its pipeline on push like any other
        if mr.get("draft"):
            print(f"skip  {tag}: draft")
            continue
        if author not in trusted:
            print(f"hold  {tag}: first-time contributor — a maintainer starts this one")
            set_label(mr, True)
            continue
        touched = {c["new_path"] for c in call("GET", f"merge_requests/{iid}/changes")["changes"]}
        if ".gitlab-ci.yml" in touched or any(p.startswith("scripts/ci/") for p in touched):
            print(f"hold  {tag}: changes the pipeline itself — a maintainer reads it first")
            set_label(mr, True)
            continue
        set_label(mr, False)
        # A pipeline that exists but never got a runner (created/pending in a fork with none)
        # is the very thing this script is for, so only a pipeline that actually ran counts.
        STUCK = {"created", "pending", "waiting_for_resource", "preparing"}
        ran = [p for p in call("GET", f"merge_requests/{iid}/pipelines") if p["sha"] == sha and p["status"] not in STUCK]
        if ran:
            where = "here" if ran[0]["project_id"] == int(PROJECT) else "in the fork"
            print(f"ok    {tag}: {sha[:8]} already has a pipeline {where} ({ran[0]['status']})")
            continue
        if triggered >= MAX_TRIGGERS:
            print(f"defer {tag}: per-run cap of {MAX_TRIGGERS} reached, next run picks it up")
            continue
        if DRY_RUN:
            print(f"would {tag}: start pipeline for {sha[:8]}")
        else:
            p = call("POST", f"merge_requests/{iid}/pipelines")
            print(f"start {tag}: pipeline {p['id']} for {sha[:8]} — {p['web_url']}")
        triggered += 1
    print(f"done: {triggered} pipeline(s) started")


if __name__ == "__main__":
    main()
