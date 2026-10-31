# Fusion - instructions for coding agents

Read and follow CLAUDE.md before every task for architecture, module boundaries,
product behavior and project rules. These instructions apply equally to Claude
and Codex and preserve the existing instructions in CLAUDE.md.

## Claude and Codex collaboration rules

Owner instruction recorded on 31 Oct 2026. Applies equally to Claude and Codex
on every task. Read CLAUDE.md and AGENTS.md together; preserve their existing
instructions. Follow only the owner's requested scope.

1. Before editing, inspect CLAUDE.md, AGENTS.md if present, Git status,
   relevant recent commits and existing uncommitted changes. Fetch the latest
   remote state. The current folder and current code take precedence over old
   conversations, handovers and ZIP copies.
2. Before changing a file, read its current relevant code and connected
   behavior, including what has already been implemented and why. Never replace
   a whole file from memory.
3. Claude's, Codex's and the owner's existing work are equally important.
   Preserve existing files, data, working features, other modules and
   uncommitted changes. Unfamiliar code is not a reason to remove or revert it.
   Make only the minimum changes required for the requested task. Preserve
   Claude's installation and configuration.
4. If the request explicitly replaces an existing feature, update only that
   relevant part and preserve the remaining behavior. If removing existing
   behavior is not clearly authorized, explain the exact impact and ask first.
   If a requirement is unclear, ask instead of guessing.
5. Integrate local and remote work safely. Never use reset --hard, git clean
   or force-push to discard existing work. Resolve conflicts by understanding
   and preserving both sides' intended changes; never blindly accept one
   whole-file version.
6. Without the owner's explicit instruction, do not change the GitHub
   repository or branch, hosting, DigitalOcean app or component, domain, DNS,
   database, environment variables or deployment configuration. Do not create a
   new server, repository or deployment setup. Do not add extra features,
   redesigns, refactoring, cleanup, package upgrades or unrelated fixes.
   Never experiment on production data.
7. Complete the requested task and run relevant checks. Immediately before
   pushing, fetch and check remote state again. If another agent has added
   commits, safely integrate them and rerun relevant checks. Stage and commit
   only the requested task's changes; exclude unrelated work. Resolve failed
   checks before pushing.
8. Once relevant checks pass, commit and push normally to
   Project7246/digithub-fusion-legal, branch main. Verify deployment on the
   existing DigitalOcean app hammerhead-app, component digithub-fusion-legal.
   Check https://ca.availity.pk/api/version for the new build and check affected
   screens. If verification is unavailable or incomplete, say exactly what
   could not be verified; never assume success.
9. If completion requires work outside the owner's instructions or a change to
   the existing setup, explain the exact reason and proposed change first, then
   wait for the owner's instruction.
10. Report in Roman Urdu: what changed, which files changed, which checks
    passed, what the owner must check themselves, and the verified deployment
    status.
