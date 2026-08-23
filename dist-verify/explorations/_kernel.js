/* ============================================================================
   PT KERNEL — the shared engine behind every exploration variant.
   ----------------------------------------------------------------------------
   All five design directions in ./ are skins over THIS file. Same data, same
   mutations, same intelligence — so a side-by-side comparison is a comparison
   of *design*, not of who got a nicer fake dataset.

   Classic script on purpose: `window.PT`, no ES modules, no fetch, no CDN.
   That makes every variant openable straight off the filesystem with a
   double-click — no dev server, no build step, no network.

   Public surface
   --------------
     PT.load() / PT.save() / PT.reset()
     PT.state                         { projects, tasks, log }
     PT.projects() / PT.tasks(opts)
     PT.addProject / PT.addTask / PT.moveTask / PT.patchTask / PT.removeTask
     PT.parse(text)                   natural-language quick-add
     PT.stats() / PT.momentum() / PT.forecast()
     PT.staleness(task) / PT.urgency(task) / PT.health(project)
     PT.nextAction()                  the single best thing to do right now
     PT.snapshotAt(ts) / PT.diff(a,b) / PT.timeline()
     PT.on(event, fn)                 'change' fires after every mutation
   ========================================================================== */
;(function (global) {
  'use strict'

  var KEY = 'pt-lab-v2'
  var DAY = 86400000

  /* ------------------------------------------------------------------------
     Deterministic RNG — the seed dataset must be byte-identical across all
     five variants, otherwise "which design reads better" turns into "which
     design got luckier numbers".
     ---------------------------------------------------------------------- */
  function mulberry32(a) {
    return function () {
      a |= 0
      a = (a + 0x6d2b79f5) | 0
      var t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  var uid = (function () {
    var n = 0
    return function (prefix) {
      n += 1
      return (prefix || 'id') + '_' + n.toString(36) + '_' + ((Date.now() % 1e6) + n).toString(36)
    }
  })()

  /* ========================================================================
     SEED — a workload that has actually been lived in.

     A blank board makes every design look good. Momentum, forecast, decay,
     overdue pressure and replay all need *history* before they mean anything,
     so the seed lays down ~5 weeks of it.
     ====================================================================== */
  var PROJECT_SEED = [
    {
      name: 'Site Redesign',
      description: 'Rebuild anteneh.tech end to end — shaders, scroll, the lot.',
      color: '#7c5cff',
      glyph: '◆',
    },
    {
      name: 'Asset Library',
      description: '3D asset pipeline: generate, tag, publish, embed.',
      color: '#22d3ee',
      glyph: '◈',
    },
    {
      name: 'CEH Prep',
      description: 'Certification study plan — modules, labs, mock exams.',
      color: '#f59e0b',
      glyph: '▲',
    },
    {
      name: 'Motion Studio',
      description: 'Gesture-controlled tools. Hand tracking to timeline scrub.',
      color: '#f43f5e',
      glyph: '●',
    },
  ]

  // [title, projectIndex, status, priority, estimateHrs, energy, ageDays, tags]
  var TASK_SEED = [
    ['Ship the WebGL prism hero', 0, 'done', 'high', 6, 'deep', 34, ['webgl', 'hero']],
    ['Design token pass — colour + type scale', 0, 'done', 'medium', 3, 'deep', 32, ['design']],
    ['Wire Supabase auth + RLS policies', 0, 'done', 'high', 5, 'deep', 30, ['backend']],
    ['Drag-and-drop task board', 0, 'done', 'high', 8, 'deep', 27, ['ui']],
    ['Cloudflare Worker deploy + custom domain', 0, 'done', 'medium', 2, 'admin', 24, ['infra']],
    ['Replace window.prompt() with a real task composer', 0, 'doing', 'high', 4, 'deep', 9, ['ui', 'debt']],
    ['Keyboard-only drag for the board', 0, 'doing', 'medium', 3, 'deep', 6, ['a11y']],
    ['Calendar view — actually build it', 0, 'todo', 'high', 10, 'deep', 21, ['feature']],
    ['Reports view — velocity + burndown', 0, 'todo', 'medium', 8, 'deep', 21, ['feature']],
    ['Settings view — theme, density, account', 0, 'todo', 'low', 4, 'admin', 21, ['feature']],
    ['Offline queue for board mutations', 0, 'todo', 'medium', 6, 'deep', 12, ['infra']],
    ['Lighthouse pass — get LCP under 1.5s', 0, 'todo', 'medium', 3, 'shallow', 4, ['perf']],
    ['Write the case study for the portfolio', 0, 'todo', 'low', 4, 'shallow', 2, ['writing']],

    ['Meshy → GLB → Draco compression pipeline', 1, 'done', 'high', 7, 'deep', 29, ['pipeline']],
    ['Asset tagging schema + FTS index', 1, 'done', 'medium', 4, 'deep', 25, ['data']],
    ['Thumbnail turntable renderer', 1, 'doing', 'high', 6, 'deep', 11, ['3d']],
    ['Licence + attribution field on every asset', 1, 'todo', 'high', 2, 'admin', 18, ['legal']],
    ['Bulk import from the old Drive folder', 1, 'todo', 'medium', 5, 'shallow', 15, ['migration']],
    ['Embed viewer — <pt-asset> web component', 1, 'todo', 'medium', 6, 'deep', 8, ['feature']],
    ['CDN cache headers for GLB payloads', 1, 'todo', 'low', 2, 'admin', 5, ['perf']],

    ['Module 1 — Footprinting & Reconnaissance', 2, 'done', 'medium', 5, 'deep', 33, ['study']],
    ['Module 2 — Scanning Networks', 2, 'done', 'medium', 5, 'deep', 28, ['study']],
    ['Module 3 — Enumeration', 2, 'done', 'medium', 5, 'deep', 22, ['study']],
    ['Module 4 — Vulnerability Analysis', 2, 'doing', 'high', 6, 'deep', 7, ['study']],
    ['Lab: Nmap + Wireshark capture exercise', 2, 'todo', 'high', 4, 'deep', 14, ['lab']],
    ['Module 5 — System Hacking', 2, 'todo', 'high', 8, 'deep', 14, ['study']],
    ['Mock exam #1 — full 4 hour sit', 2, 'todo', 'high', 4, 'deep', 10, ['exam']],
    ['Flashcard deck for ports + protocols', 2, 'todo', 'low', 2, 'shallow', 19, ['study']],

    ['MediaPipe hand tracking spike', 3, 'done', 'high', 6, 'deep', 26, ['spike']],
    ['Pinch-to-scrub timeline mapping', 3, 'done', 'high', 7, 'deep', 20, ['feature']],
    ['Gesture smoothing — one-euro filter', 3, 'doing', 'medium', 4, 'deep', 3, ['math']],
    ['Calibration flow for new users', 3, 'todo', 'medium', 5, 'deep', 16, ['ux']],
    ['Fallback to mouse when no camera', 3, 'todo', 'high', 3, 'shallow', 16, ['a11y']],
    ['Record + export a gesture session', 3, 'todo', 'low', 6, 'deep', 9, ['feature']],
  ]

  function buildSeed() {
    var rnd = mulberry32(0x5eed17)
    var now = Date.now()
    var midnight = new Date(now)
    midnight.setHours(9, 0, 0, 0)
    var anchor = midnight.getTime()

    var projects = PROJECT_SEED.map(function (p, i) {
      return {
        id: 'p' + (i + 1),
        name: p.name,
        description: p.description,
        color: p.color,
        glyph: p.glyph,
        status: 'active',
        position: i,
        createdAt: anchor - (36 - i * 2) * DAY,
      }
    })

    var log = []
    var tasks = TASK_SEED.map(function (row, i) {
      var title = row[0]
      var pi = row[1]
      var status = row[2]
      var priority = row[3]
      var estimate = row[4]
      var energy = row[5]
      var ageDays = row[6]
      var tags = row[7]

      var createdAt = anchor - ageDays * DAY - Math.floor(rnd() * 6) * 3600000
      var id = 't' + (i + 1)

      // Done tasks finished somewhere between creation and now, weighted late
      // so the trailing-14-day velocity window has real signal in it.
      var doneAt = null
      var touchedAt = createdAt
      if (status === 'done') {
        var span = anchor - createdAt
        doneAt = createdAt + span * (0.45 + rnd() * 0.5)
        touchedAt = doneAt
      } else if (status === 'doing') {
        touchedAt = anchor - Math.floor(rnd() * 3) * DAY
      } else {
        // Stale-on-purpose: some todos have not been touched since creation.
        touchedAt = createdAt + (rnd() < 0.45 ? 0 : Math.floor(rnd() * ageDays * 0.4) * DAY)
      }

      // Due dates: a deliberate mix of comfortably ahead, tight, and overdue —
      // urgency and the "overdue" pressure signals need all three to exist.
      var due = null
      var roll = rnd()
      if (status !== 'done') {
        if (roll < 0.22) due = anchor - Math.ceil(rnd() * 9) * DAY // overdue
        else if (roll < 0.6) due = anchor + Math.ceil(rnd() * 6) * DAY // this week
        else if (roll < 0.85) due = anchor + (7 + Math.ceil(rnd() * 14)) * DAY
      }

      log.push({ ts: createdAt, type: 'task.add', id: id, to: 'todo', title: title, project: projects[pi].id })
      if (status === 'doing') log.push({ ts: touchedAt, type: 'task.move', id: id, from: 'todo', to: 'doing' })
      if (status === 'done') {
        log.push({ ts: createdAt + (doneAt - createdAt) * 0.4, type: 'task.move', id: id, from: 'todo', to: 'doing' })
        log.push({ ts: doneAt, type: 'task.move', id: id, from: 'doing', to: 'done' })
      }

      return {
        id: id,
        projectId: projects[pi].id,
        title: title,
        notes: '',
        status: status,
        priority: priority,
        estimate: estimate,
        energy: energy,
        tags: tags,
        position: i,
        due: due,
        createdAt: createdAt,
        touchedAt: touchedAt,
        doneAt: doneAt,
      }
    })

    log.sort(function (a, b) {
      return a.ts - b.ts
    })

    return { projects: projects, tasks: tasks, log: log, version: 2 }
  }

  /* ========================================================================
     STORE
     ====================================================================== */
  var state = null
  var listeners = []

  function load() {
    if (state) return state
    try {
      var raw = global.localStorage && global.localStorage.getItem(KEY)
      if (raw) {
        var parsed = JSON.parse(raw)
        if (parsed && parsed.version === 2 && parsed.tasks && parsed.tasks.length) {
          state = parsed
          return state
        }
      }
    } catch (e) {
      /* private mode, quota, corrupt JSON — fall through to a fresh seed */
    }
    state = buildSeed()
    save()
    return state
  }

  function save() {
    try {
      global.localStorage && global.localStorage.setItem(KEY, JSON.stringify(state))
    } catch (e) {
      /* nothing persistable — the session still works in memory */
    }
  }

  function reset() {
    state = buildSeed()
    save()
    emit('change', { reason: 'reset' })
    return state
  }

  function emit(evt, detail) {
    for (var i = 0; i < listeners.length; i++) {
      if (listeners[i].evt === evt) {
        try {
          listeners[i].fn(detail)
        } catch (e) {
          if (global.console) console.error('[PT] listener failed', e)
        }
      }
    }
  }

  function on(evt, fn) {
    listeners.push({ evt: evt, fn: fn })
    return function off() {
      listeners = listeners.filter(function (l) {
        return l.fn !== fn
      })
    }
  }

  function commit(entry) {
    load()
    entry.ts = Date.now()
    state.log.push(entry)
    save()
    emit('change', entry)
  }

  /* ========================================================================
     READS
     ====================================================================== */
  function projects() {
    return load().projects.slice().sort(function (a, b) {
      return a.position - b.position
    })
  }

  function task(id) {
    return load().tasks.filter(function (t) {
      return t.id === id
    })[0]
  }

  function project(id) {
    return load().projects.filter(function (p) {
      return p.id === id
    })[0]
  }

  /** tasks({ project, status, tag }) — every filter is optional. */
  function tasks(opts) {
    opts = opts || {}
    return load()
      .tasks.filter(function (t) {
        if (opts.project && t.projectId !== opts.project) return false
        if (opts.status && t.status !== opts.status) return false
        if (opts.tag && t.tags.indexOf(opts.tag) === -1) return false
        return true
      })
      .sort(function (a, b) {
        return a.position - b.position
      })
  }

  /* ========================================================================
     WRITES — every one lands in the log, which is what makes replay possible
     ====================================================================== */
  function addProject(name, opts) {
    opts = opts || {}
    load()
    var palette = ['#7c5cff', '#22d3ee', '#f59e0b', '#f43f5e', '#10b981', '#e879f9']
    var p = {
      id: uid('p'),
      name: name,
      description: opts.description || '',
      color: opts.color || palette[state.projects.length % palette.length],
      glyph: opts.glyph || '◇',
      status: 'active',
      position: state.projects.length,
      createdAt: Date.now(),
    }
    state.projects.push(p)
    commit({ type: 'project.add', id: p.id, name: name })
    return p
  }

  function removeProject(id) {
    load()
    state.projects = state.projects.filter(function (p) {
      return p.id !== id
    })
    state.tasks = state.tasks.filter(function (t) {
      return t.projectId !== id
    })
    commit({ type: 'project.remove', id: id })
  }

  function addTask(projectId, title, opts) {
    opts = opts || {}
    load()
    var t = {
      id: uid('t'),
      projectId: projectId,
      title: title,
      notes: opts.notes || '',
      status: opts.status || 'todo',
      priority: opts.priority || 'medium',
      estimate: opts.estimate || 2,
      energy: opts.energy || 'deep',
      tags: opts.tags || [],
      position: state.tasks.length,
      due: opts.due || null,
      createdAt: Date.now(),
      touchedAt: Date.now(),
      doneAt: null,
    }
    state.tasks.push(t)
    commit({ type: 'task.add', id: t.id, title: title, project: projectId, to: t.status })
    return t
  }

  function moveTask(id, status) {
    load()
    var t = task(id)
    if (!t || t.status === status) return t
    var from = t.status
    t.status = status
    t.touchedAt = Date.now()
    t.doneAt = status === 'done' ? Date.now() : null
    commit({ type: 'task.move', id: id, from: from, to: status })
    return t
  }

  function patchTask(id, patch) {
    load()
    var t = task(id)
    if (!t) return null
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) t[k] = patch[k]
    t.touchedAt = Date.now()
    commit({ type: 'task.patch', id: id, patch: patch })
    return t
  }

  function removeTask(id) {
    load()
    var t = task(id)
    state.tasks = state.tasks.filter(function (x) {
      return x.id !== id
    })
    commit({ type: 'task.remove', id: id, title: t ? t.title : '' })
  }

  /* ========================================================================
     NATURAL-LANGUAGE QUICK-ADD

       "ship the hero !high @fri #webgl ~6h /redesign *deep"

       !low !medium !high   priority
       @today @tomorrow @fri @2026-08-14 @3d    due date
       #tag                 tag (repeatable)
       ~6h  ~90m            estimate
       /redesign            project, fuzzy-matched on name
       *deep *shallow *admin  energy required
     ====================================================================== */
  var WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

  function parseDue(token) {
    var now = new Date()
    now.setHours(17, 0, 0, 0)
    var t = token.toLowerCase()

    if (t === 'today') return now.getTime()
    if (t === 'tomorrow' || t === 'tmr') return now.getTime() + DAY
    if (t === 'eow' || t === 'friday') t = 'fri'

    var rel = /^(\d+)([dwh])$/.exec(t)
    if (rel) {
      var n = parseInt(rel[1], 10)
      var mult = rel[2] === 'd' ? DAY : rel[2] === 'w' ? 7 * DAY : 3600000
      return Date.now() + n * mult
    }

    var wd = WEEKDAYS.indexOf(t.slice(0, 3))
    if (wd >= 0) {
      var delta = (wd - now.getDay() + 7) % 7
      return now.getTime() + (delta === 0 ? 7 : delta) * DAY
    }

    var iso = Date.parse(token)
    return isNaN(iso) ? null : iso
  }

  function parse(text) {
    var out = {
      title: '',
      priority: 'medium',
      due: null,
      tags: [],
      estimate: 2,
      energy: 'deep',
      projectId: null,
      projectQuery: null,
    }
    var words = String(text || '').trim().split(/\s+/)
    var title = []

    for (var i = 0; i < words.length; i++) {
      var w = words[i]
      if (!w) continue
      var head = w[0]
      var body = w.slice(1)

      if (head === '!' && /^(low|medium|med|high)$/i.test(body)) {
        out.priority = /^(med|medium)$/i.test(body) ? 'medium' : body.toLowerCase()
      } else if (head === '@' && body) {
        var d = parseDue(body)
        if (d) out.due = d
        else title.push(w)
      } else if (head === '#' && body) {
        out.tags.push(body.toLowerCase())
      } else if (head === '~' && /^\d+(\.\d+)?[hm]?$/i.test(body)) {
        var num = parseFloat(body)
        out.estimate = /m$/i.test(body) ? Math.round((num / 60) * 10) / 10 : num
      } else if (head === '*' && /^(deep|shallow|admin)$/i.test(body)) {
        out.energy = body.toLowerCase()
      } else if (head === '/' && body) {
        out.projectQuery = body.toLowerCase()
      } else {
        title.push(w)
      }
    }

    out.title = title.join(' ').trim()

    if (out.projectQuery) {
      var q = out.projectQuery
      var hit = projects().filter(function (p) {
        return p.name.toLowerCase().replace(/\s+/g, '').indexOf(q.replace(/\s+/g, '')) >= 0
      })[0]
      if (hit) out.projectId = hit.id
    }
    return out
  }

  /** Parse a line and commit it in one step. Returns the created task. */
  function quickAdd(text, fallbackProjectId) {
    var p = parse(text)
    if (!p.title) return null
    var pid = p.projectId || fallbackProjectId || (projects()[0] && projects()[0].id)
    if (!pid) return null
    return addTask(pid, p.title, {
      priority: p.priority,
      due: p.due,
      tags: p.tags,
      estimate: p.estimate,
      energy: p.energy,
    })
  }

  /* ========================================================================
     INTELLIGENCE — the numbers a plain board never tells you
     ====================================================================== */
  function stats(projectId) {
    var all = tasks(projectId ? { project: projectId } : {})
    var done = 0, doing = 0, todo = 0, overdue = 0, hoursLeft = 0
    var now = Date.now()
    all.forEach(function (t) {
      if (t.status === 'done') done++
      else {
        if (t.status === 'doing') doing++
        else todo++
        hoursLeft += t.estimate || 0
        if (t.due && t.due < now) overdue++
      }
    })
    return {
      total: all.length,
      done: done,
      doing: doing,
      todo: todo,
      overdue: overdue,
      hoursLeft: Math.round(hoursLeft * 10) / 10,
      pct: all.length ? Math.round((done / all.length) * 100) : 0,
    }
  }

  /**
   * Velocity, in tasks per day, over a trailing window — with the recent half
   * weighted double. A 3-week-old burst shouldn't claim you're still fast.
   */
  function momentum(windowDays, projectId) {
    var win = windowDays || 14
    var now = Date.now()
    var cutoff = now - win * DAY
    var recent = 0, older = 0
    load().tasks.forEach(function (t) {
      if (projectId && t.projectId !== projectId) return
      if (t.status !== 'done' || !t.doneAt || t.doneAt < cutoff) return
      if (t.doneAt > now - (win / 2) * DAY) recent++
      else older++
    })
    var weighted = recent * 2 + older
    var perDay = weighted / (win * 1.5)
    var trend = older === 0 ? (recent > 0 ? 1 : 0) : recent / older - 1
    return {
      completed: recent + older,
      recent: recent,
      older: older,
      perDay: Math.round(perDay * 100) / 100,
      perWeek: Math.round(perDay * 7 * 10) / 10,
      trend: Math.max(-1, Math.min(1, Math.round(trend * 100) / 100)),
      windowDays: win,
    }
  }

  /**
   * "At this pace you finish on ___." Deliberately honest: if velocity is
   * zero it says so rather than inventing a date.
   */
  function forecast(projectId) {
    var s = stats(projectId)
    var remaining = s.total - s.done
    if (remaining === 0) return { done: true, days: 0, date: null, remaining: 0, perDay: 0 }

    // Scope velocity to the project itself — a project you've actually been
    // shipping on forecasts sooner than one you've ignored for three weeks,
    // which is the whole point. Blend in a floor of the global rate so a
    // project with one quiet fortnight doesn't read as "never".
    var local = momentum(28, projectId)
    var globalRate = momentum(28).perDay
    var effective = projectId
      ? Math.max(local.perDay, globalRate * 0.12)
      : globalRate

    if (effective <= 0) return { done: false, days: Infinity, date: null, remaining: remaining, perDay: 0 }
    var days = Math.ceil(remaining / effective)
    return {
      done: false,
      days: days,
      date: new Date(Date.now() + days * DAY),
      remaining: remaining,
      perDay: Math.round(effective * 100) / 100,
    }
  }

  /** 0 = touched today, 1 = abandoned. Non-linear: the first week is cheap. */
  function staleness(t) {
    if (!t || t.status === 'done') return 0
    var days = (Date.now() - t.touchedAt) / DAY
    return Math.max(0, Math.min(1, Math.pow(days / 21, 1.4)))
  }

  /** 0 = no deadline pressure, 1 = badly overdue. */
  function urgency(t) {
    if (!t || t.status === 'done') return 0
    if (!t.due) return 0.15
    var days = (t.due - Date.now()) / DAY
    if (days <= 0) return Math.min(1, 0.8 + Math.abs(days) / 14)
    if (days >= 14) return 0.1
    return Math.max(0.1, 0.8 - (days / 14) * 0.7)
  }

  /** Composite 0..1 for a project. Reads as a colour in most of the variants. */
  function health(projectId) {
    var s = stats(projectId)
    if (s.total === 0) return 1
    var open = tasks({ project: projectId }).filter(function (t) {
      return t.status !== 'done'
    })
    var avgStale = open.length
      ? open.reduce(function (a, t) {
          return a + staleness(t)
        }, 0) / open.length
      : 0
    var overdueRatio = open.length ? s.overdue / open.length : 0
    var progress = s.pct / 100
    var score = 0.4 * progress + 0.3 * (1 - overdueRatio) + 0.3 * (1 - avgStale)
    return Math.max(0, Math.min(1, score))
  }

  var PRIORITY_WEIGHT = { high: 1, medium: 0.55, low: 0.25 }

  /**
   * The one task worth starting right now.
   *
   * Scored, not guessed: deadline pressure first, then priority, then a nudge
   * for things already in progress (finishing beats starting), then a small
   * bonus for short tasks so a 10-hour epic never permanently blocks the queue.
   */
  function score(t) {
    if (!t || t.status === 'done') return -1
    var s =
      urgency(t) * 3.2 +
      (PRIORITY_WEIGHT[t.priority] || 0.5) * 2.4 +
      (t.status === 'doing' ? 1.6 : 0) +
      staleness(t) * 0.9 +
      Math.max(0, 1 - (t.estimate || 2) / 10) * 0.7
    return Math.round(s * 1000) / 1000
  }

  function nextAction(projectId) {
    var open = tasks(projectId ? { project: projectId } : {}).filter(function (t) {
      return t.status !== 'done'
    })
    if (!open.length) return null
    var ranked = open
      .map(function (t) {
        return { task: t, score: score(t) }
      })
      .sort(function (a, b) {
        return b.score - a.score
      })
    var top = ranked[0]
    return {
      task: top.task,
      score: top.score,
      runnerUp: ranked[1] ? ranked[1].task : null,
      why: explain(top.task),
      queue: ranked.slice(0, 5).map(function (r) {
        return r.task
      }),
    }
  }

  function explain(t) {
    var bits = []
    var now = Date.now()
    if (t.due && t.due < now) bits.push(Math.ceil((now - t.due) / DAY) + 'd overdue')
    else if (t.due && t.due - now < 3 * DAY) bits.push('due ' + relDay(t.due))
    if (t.priority === 'high') bits.push('high priority')
    if (t.status === 'doing') bits.push('already started')
    var st = staleness(t)
    if (st > 0.4) bits.push('untouched ' + Math.floor((now - t.touchedAt) / DAY) + 'd')
    if ((t.estimate || 2) <= 2) bits.push('short — ' + t.estimate + 'h')
    if (!bits.length) bits.push('top of the queue')
    return bits.join(' · ')
  }

  /* ========================================================================
     TIME TRAVEL — replay the log to any point and diff two moments
     ====================================================================== */

  /** Board membership as it stood at `ts`. Returns { taskId: status }. */
  function snapshotAt(ts) {
    var snap = {}
    var log = load().log
    for (var i = 0; i < log.length; i++) {
      var e = log[i]
      if (e.ts > ts) break
      if (e.type === 'task.add') snap[e.id] = e.to || 'todo'
      else if (e.type === 'task.move') snap[e.id] = e.to
      else if (e.type === 'task.remove') delete snap[e.id]
    }
    return snap
  }

  /** What changed between two moments — the raw material for a weekly retro. */
  function diff(fromTs, toTs) {
    var a = snapshotAt(fromTs)
    var b = snapshotAt(toTs)
    var added = [], completed = [], started = [], removed = [], moved = []

    Object.keys(b).forEach(function (id) {
      if (!(id in a)) {
        added.push(id)
        if (b[id] === 'done') completed.push(id)
        return
      }
      if (a[id] === b[id]) return
      if (b[id] === 'done') completed.push(id)
      else if (b[id] === 'doing' && a[id] === 'todo') started.push(id)
      else moved.push(id)
    })
    Object.keys(a).forEach(function (id) {
      if (!(id in b)) removed.push(id)
    })

    return {
      from: fromTs,
      to: toTs,
      added: added,
      completed: completed,
      started: started,
      moved: moved,
      removed: removed,
      net: completed.length - added.length,
    }
  }

  /** Day-by-day series for burndown / sparkline drawing. */
  function timeline(days) {
    var n = days || 30
    var out = []
    var end = Date.now()
    for (var i = n; i >= 0; i--) {
      var ts = end - i * DAY
      var snap = snapshotAt(ts)
      var d = 0, g = 0, o = 0
      Object.keys(snap).forEach(function (id) {
        if (snap[id] === 'done') d++
        else if (snap[id] === 'doing') g++
        else o++
      })
      out.push({ ts: ts, done: d, doing: g, todo: o, open: g + o, total: d + g + o })
    }
    return out
  }

  /* ========================================================================
     FORMATTING HELPERS — shared so every variant says dates the same way
     ====================================================================== */
  function relDay(ts) {
    if (ts == null) return '—'
    var days = Math.round((ts - Date.now()) / DAY)
    if (days === 0) return 'today'
    if (days === 1) return 'tomorrow'
    if (days === -1) return 'yesterday'
    if (days < 0) return Math.abs(days) + 'd ago'
    if (days < 7) return 'in ' + days + 'd'
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  function shortDate(ts) {
    return ts == null
      ? '—'
      : new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v))
  }

  /** Motion budget: every variant must check this before animating. */
  function reducedMotion() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches)
  }

  global.PT = {
    DAY: DAY,
    load: load,
    save: save,
    reset: reset,
    on: on,
    get state() {
      return load()
    },
    projects: projects,
    project: project,
    tasks: tasks,
    task: task,
    addProject: addProject,
    removeProject: removeProject,
    addTask: addTask,
    moveTask: moveTask,
    patchTask: patchTask,
    removeTask: removeTask,
    parse: parse,
    quickAdd: quickAdd,
    stats: stats,
    momentum: momentum,
    forecast: forecast,
    staleness: staleness,
    urgency: urgency,
    health: health,
    score: score,
    nextAction: nextAction,
    explain: explain,
    snapshotAt: snapshotAt,
    diff: diff,
    timeline: timeline,
    relDay: relDay,
    shortDate: shortDate,
    clamp: clamp,
    reducedMotion: reducedMotion,
  }
})(window)
