# Umbrel Monorepo Agent Guide

## Skills

- Before starting work, check `.agents/skills/` for any skill relevant to the task. If a skill matches the work, read its `SKILL.md` and follow it.

## Worktrees

- Start every new piece of work in its own git worktree under `worktrees/`, named after the branch it holds:

  ```sh
  git worktree add worktrees/<branch> -b <branch> origin/staging
  ```

- Don't work directly in the root checkout, and don't create worktrees anywhere else. One branch, one worktree, matching names, all in `worktrees/`.
- There's nothing to set up: `git worktree add` creates `worktrees/` if it's missing, and the directory is gitignored, so nothing inside it is ever committed.
- Remove the worktree once its branch is merged:

  ```sh
  git worktree remove worktrees/<branch>
  ```

## Pull requests

- Open the PR against the same repository as `git origin` unless you're asked to target another remote. Either way pass `--repo` explicitly, since `gh` infers a target when it's omitted.
- Push regularly rather than saving everything for one commit at the end. Each commit should be atomic: one self-contained change that leaves the tree working on its own.
- Write the PR title and description as a high-level overview of the overall change: what it does, why, and what it means for users and the rest of the system, not a replay of the commits. **The title and description become the commit message when the PR is squash-merged**, so they are what everyone reads in `git log` later.
- Put testing logs, measurements, investigation notes and other detail in PR comments, not the description. When a description has grown long, copy the full text into a comment before rewriting it, so the context stays on the PR.
- The commit message will be public, so don't mention private issues, PRs or other internal details in the title or description. Link them in a PR comment instead.
- When a user reported the problem in a public issue or PR, credit them by GitHub username and link to it with its full URL.
- Only claim what the change has been shown to do. Report measurements as measurements, and don't say it fixes a problem unless that's been verified.
- Keep the description current as the implementation changes. When it's merged it must describe what the PR actually does, not what it originally set out to do.
