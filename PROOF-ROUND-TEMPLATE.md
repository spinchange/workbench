# Proof Round Template

Use this template to evaluate whether Workbench should continue toward MVP or be abandoned.

## Preconditions

- [ ] Git works without safe-directory noise
- [ ] Shell host works reliably
- [ ] Workbench can bind a repo with minimal setup
- [ ] Outputs are readable without manual cleanup

If any precondition fails, stop and fix the environment before scoring the product.

## Repos

Record at least:

- one package repo with a real test script
- one git-only repo
- one repo you actually care about

## Workflow 1: Repo Audit

Repo:

Command:

Output summary:

Did it beat your normal workflow? `yes` / `no`

Why:

Useful fact surfaced:

Pass / Fail:

## Workflow 2: Persistent Investigation

Repo:

Command sequence:

What state was cached:

How was it reused:

Did it beat your normal workflow? `yes` / `no`

Why:

Pass / Fail:

## Workflow 3: Verify Before Change

Repo:

Command:

Output summary:

Did it beat your normal workflow? `yes` / `no`

Why:

Did it clarify the next action:

Pass / Fail:

## Scoring

- [ ] At least 2 of 3 workflows clearly beat the normal terminal workflow
- [ ] No workflow failed due to product design

Continue only if both are true.

## Strong Continue Signals

Mark any that occurred:

- [ ] This saved me time
- [ ] I want this state to persist
- [ ] This is a better starting posture than raw shell
- [ ] I would use this again tomorrow

## Strong Bail Signals

Mark any that occurred:

- [ ] I can do this faster directly
- [ ] This output is nice but not useful
- [ ] Persistence is not buying me much
- [ ] This feels clever, not necessary

## Decision

Continue / Bail:

Reason:

Next action:
