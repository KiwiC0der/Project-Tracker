# Audit log

Where audit results live, and the one rule that decides which of the two places
a given result goes to.

## The split, and why there is one

This repository is **public**. An audit report is a list of the ways an
application can be broken, written by someone who just spent hours finding out.
Publishing one while the findings are still live is writing an attacker's
to-do list and hosting it for them.

So results are split by whether they are still exploitable:

| Location | Committed? | Holds |
|---|---|---|
| `docs/audits/` | Yes — public | Reports for findings that are **fixed and deployed**. Baselines, budgets and metric history. |
| `.audit/` | **No** — gitignored | Raw tool output, and any finding that is **still live**. |

A finding moves from `.audit/` to `docs/audits/` when its fix is deployed, not
when it is written — the fix has to be in production, because the public report
is only safe once the thing it describes no longer works.

`.audit/` is deliberately *not* encrypted or hidden beyond `.gitignore`. It is
on the maintainer's own machine, and a private file that is inconvenient to read
is a private file nobody reads. If this ever needs to leave the machine, put it
somewhere with access control — not in a public repo with a scary filename.

## What a report is for

The report is the artefact that makes the *next* run cheap. A report that only
says "we looked and it was fine" is worth almost nothing on the second run,
because it cannot tell you whether something changed. So each one records:

- **What was measured, and against which named standard** — not "accessibility"
  but "WCAG 2.2 AA", not "fast enough" but "LCP at p75".
- **The number**, so the next run is a comparison rather than a fresh opinion.
- **What was fixed**, with the commit.
- **What was accepted**, with the reason. An accepted risk that is written down
  is a decision; one that is not is an oversight waiting to be rediscovered.
- **What the run could not check**, which is the most easily lost and most
  valuable line in the document.

## Baselines

`baselines/` holds the committed numbers that gates ratchet against — the
counts, budgets and thresholds that make a check fail on *new* debt only.

Every gate ships with its baseline in the same commit. A gate introduced at
zero on a codebase that is not at zero fails immediately, gets bypassed within
a week, and is then worse than no gate at all: it reports green because it is
switched off.

## Naming

```
docs/audits/YYYY-MM-DD-<slug>.md     e.g. 2026-08-25-rls-correctness.md
```

Dated, because the question is almost always "what did this look like last
time", and sorting by name should answer it.
