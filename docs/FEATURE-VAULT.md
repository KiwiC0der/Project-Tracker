# Feature Vault

Capabilities that a task tracker does not normally have, that turn out to be
hard to give up once you have them.

Everything in **Part 1 is built and running** in
[`public/explorations/_kernel.js`](../public/explorations/_kernel.js) — every one of the
five prototypes can call it today. Part 2 is the next tier: designed, costed,
not yet built.

The organising principle: **a tracker already knows far more than it tells you.**
Every row has a creation time, a touch time, a completion time, an estimate and a
due date. Almost no tracker does arithmetic on any of it. These features are
mostly not new data — they are the questions nobody asked of the data that was
already there.

---

## Part 1 — Built into the kernel

### 1. Momentum — are you speeding up or slowing down?

`PT.momentum(windowDays?, projectId?)` → `{ perDay, perWeek, trend, recent, older }`

Completions over a trailing window, with the recent half weighted double. A
burst three weeks ago should not let you believe you are still fast.

`trend` is a signed −1…1 number, so the UI can say **"falling"** rather than
showing a number and leaving you to interpret it. Scoped per project, so
"Asset Library is stalling while CEH Prep accelerates" is one call.

> Why it matters: every tracker shows *how much is left*. Almost none show
> *how fast you are going*, which is the only number that predicts anything.

### 2. Landing date — when does this actually finish?

`PT.forecast(projectId?)` → `{ days, date, remaining, perDay }`

Remaining work divided by your own measured velocity. Per-project forecasts use
that project's own completion rate, with a floor derived from your global rate,
so a project you ignored for a fortnight forecasts later than one you have been
shipping on — which is the truth.

It refuses to lie: at zero velocity it returns `days: Infinity, date: null` and
the UI is required to say "no measurable pace" instead of inventing a Friday.

> A progress bar at 35% tells you nothing about time. "At this pace: Tue 15 Sep"
> changes what you do this afternoon.

### 3. Staleness — work rots, and you should be able to see it

`PT.staleness(task)` → `0…1`

Days since `touchedAt`, on a `pow(days/21, 1.4)` curve, so the first week is
nearly free and the fourth week is brutal.

This is the feature nobody asks for and everybody needs. Every backlog is 40%
things that quietly died. Staleness makes the death visible: in ORBIT stale
tasks fade and drift outward, in PULSE they go cold and dim, in BROADSHEET they
get an obituary column with **REVIVE** and **LET GO** buttons.

> The point is not shame. The point is that deleting dead work is the single
> highest-leverage action in any backlog, and no tracker ever prompts it.

### 4. Urgency as a continuous field

`PT.urgency(task)` → `0…1`

Deadline pressure as a smooth curve, not a boolean "overdue" flag. Overdue
scales past 0.8 with how overdue. 14+ days out floors at 0.1. No due date is a
deliberate 0.15 — mild, not zero, because undated work is not actually free.

Because it is continuous it can drive *anything*: orbital radius, colour
temperature, shader turbulence, sort order.

### 5. "Do this next" that can defend itself

`PT.nextAction(projectId?)` → `{ task, score, why, queue, runnerUp }`

A transparent weighted score:

```
urgency × 3.2  +  priority × 2.4  +  (already started ? 1.6 : 0)
               +  staleness × 0.9  +  shortness × 0.7
```

The "already started" term means finishing beats starting. The shortness term
means a 10-hour epic never permanently blocks the queue.

Critically it returns `why` — `PT.explain(task)` produces *"7d overdue · high
priority · already started"*. **A recommendation you cannot audit is one you
will not trust.** This one shows its work.

### 6. Natural-language capture

`PT.quickAdd(text)` / `PT.parse(text)`

```
ship the hero !high @fri #webgl ~6h /redesign *deep
```

| Token | Sets |
|---|---|
| `!low !medium !high` | priority |
| `@today @fri @3d @2026-08-14` | due date |
| `#tag` | tags, repeatable |
| `~6h` `~90m` | estimate |
| `/redesign` | project, fuzzy-matched on name |
| `*deep *shallow *admin` | energy required |

One line, one keystroke to commit, six fields set. Compare with the current
app's `window.prompt('Task title')`, which sets one field and offers no others.

`parse()` is exposed separately so the UI can show a **live preview of what will
be created before you commit** — WORKBENCH's console does exactly this.

### 7. Time travel

`PT.snapshotAt(ts)` → `{ taskId: status }`

Every mutation is appended to an event log. Replaying it to any timestamp
reconstructs the board as it stood. This is the capability the current app
throws away on every write.

It unlocks: TERMINAL's `replay` command (watch your month redraw itself like a
screen recording), BROADSHEET's back-issue date stepper (the entire front page
re-renders as it was that morning), and any burndown chart that is honest rather
than extrapolated.

### 8. Diff between two moments

`PT.diff(fromTs, toTs)` → `{ added, completed, started, moved, removed, net }`

The raw material for a weekly retro that writes itself. `net` — completed minus
added — is the number that tells you whether you are actually converging or
just churning. It is very often negative, and nobody who needs to know that
currently finds out.

### 9. Real burndown from real history

`PT.timeline(days)` → daily `{ done, doing, todo, open, total }`

Replays the log day by day. Not a projection, not a straight line from a
start-of-sprint guess — what was actually true each day, including the days you
added scope.

### 10. Project health as one number

`PT.health(projectId)` → `0…1`

`0.4 × progress + 0.3 × (1 − overdue ratio) + 0.3 × (1 − mean staleness)`

Deliberately not "percent complete". A project that is 80% done with everything
overdue and untouched for a month is not healthy, and this says so.

Because it is one normalised number it can drive a shader uniform, a colour, a
star's brightness — which is exactly what PULSE and ORBIT do with it.

---

## Part 2 — Designed, not yet built

Ranked by value per unit of work.

### 11. Energy-matched scheduling ★

The schema already carries `energy: deep | shallow | admin`. Combine it with
time of day and completion history to learn *when* you actually finish deep work,
then surface the right kind of task for the current hour. At 4pm on a Friday it
should stop suggesting an 8-hour architecture task and offer the 20-minute admin
one.

*Everyone builds "what should I do next". Almost nobody conditions it on what
you are currently capable of.*

### 12. The weekly edition, delivered ★

`PT.diff(now − 7d, now)` already computes it. Render it as prose, generate it
every Monday, and — with permission — email or push it. Four lines: what
shipped, what slipped, what rotted, what is landing this week.

Retros do not happen because writing them is work. This one writes itself.

### 13. Scope-creep alarm ★

Watch `diff.net` over a rolling window. When added consistently exceeds
completed, say so out loud: *"You have added 11 and finished 4 in two weeks.
Site Redesign is growing faster than you are shipping it."*

Cheap to compute, and it names the single most common way projects die.

### 14. Board diff between any two dates

Two date pickers, one output: exactly what changed. The natural companion to
time travel, and the thing you want in front of you before any status meeting.

### 15. Public status page per project

One read-only URL per project. Live progress, forecast landing date, recent
completions. No account needed to view.

The infrastructure already exists — RLS is scoped to `auth.uid()`, so this needs
one nullable `public_slug` column and one policy allowing anonymous select where
that slug is set. Perhaps 40 lines. It converts a personal tracker into
something you can send a client.

### 16. Critical path

Add a `blocked_by` array and compute the longest dependency chain. The critical
path is the only sequence where a one-day slip slips the whole project, and it
is almost never the sequence people work on. WORKBENCH's graph window is where
this lands.

### 17. Focus sessions as first-class data

PULSE has a focus timer. Persist the sessions and you gain: real elapsed time
against `estimate`, so estimates can be calibrated against your own historical
error factor rather than optimism. After twenty tasks the app can tell you *"you
estimate at about 0.6× actual"* and quietly correct every forecast.

### 18. Undo, properly

The event log is already an undo stack. Every destructive action becomes
reversible, and the current app's confirm-dialog-on-project-delete /
nothing-at-all-on-task-delete inconsistency disappears. Ctrl+Z, a toast with
UNDO, done.

### 19. Offline-first with an outbox

Queue mutations in IndexedDB, replay on reconnect, resolve conflicts
last-write-wins per field. The current app fails a drag with a red banner if the
network blinks.

### 20. Ambient mode as a product

PULSE is already designed for a second monitor. Ship it as a standalone route,
a screensaver, a widget. A tracker you glance at forty times a day without
opening is a different product from one you have to visit.

---

## Where each lands

| # | Feature | TERMINAL | ORBIT | BROADSHEET | WORKBENCH | PULSE |
|---|---|:--:|:--:|:--:|:--:|:--:|
| 1 | Momentum | `stat` | HUD | By The Numbers | Pulse window | **Pace** |
| 2 | Forecast | `stat` | HUD | By The Numbers | Pulse window | **Landing** |
| 3 | Staleness | dim rows | fade + drift | **Obituaries** | graph nodes | cold cells |
| 4 | Urgency | due marker | **orbit radius** | red rule | Gantt overhang | tremor |
| 5 | Next action | `next` | **Centre of mass** | **Lead story** | focus this | **Do This** |
| 6 | Quick-add | `add` | `+` | Classified ad | **live preview** | quick add |
| 7 | Time travel | **`replay`** | — | **Back issues** | — | — |
| 8 | Diff | — | — | **Weekend Retro** | — | — |
| 9 | Burndown | **`burn`** ASCII | — | SVG chart | Timeline | sparkline |
| 10 | Health | statusline | **star brightness** | conditions line | wallpaper tint | **shader** |

Bold = that direction's signature expression of the feature.
