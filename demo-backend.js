// Ремзона · демо-версия: вместо облачной базы -- имитация сервера в браузере.
// Все данные вымышленные и живут только в этом браузере (localStorage); «Сбросить демо» -- заново.
// Повторяет то, что делает настоящий сервер: правила записи jobs (rev, механик, участок), участок в выдаче,
// Realtime (изменения и «кто в приложении»), фото, сотрудники, перенос в Excel-книгу (имитация раз в 25 с).
(function () {
  "use strict";
  const DB_KEY = "rzd_db_v1", AUTH_KEY = "rz_auth", PIN = "1111";
  const SITES = ["Северный", "Южный"];
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "x" + Date.now().toString(36) + Math.random().toString(36).slice(2));
  const iso = (t) => new Date(t).toISOString();
  const H = 3600000, MIN = 60000;

  // ---------- вымышленные данные: 30 суток работы двух участков ----------
  function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function seed() {
    const R = rnd(20261126), pick = (a) => a[Math.floor(R() * a.length)], between = (a, b) => a + R() * (b - a);
    const staff = [
      { name: "Смирнов А.В.", role: "admin", login: "smirnov", owner: true, site: "Северный" },
      { name: "Орлова Е.С.", role: "admin", login: "orlova", owner: false, site: "Южный" },
      { name: "Иванов И.И.", role: "mechanic", login: "ivanov", site: "Северный" },
      { name: "Петров С.Н.", role: "mechanic", login: "petrov", site: "Северный" },
      { name: "Кузнецов Д.А.", role: "mechanic", login: "kuznetsov", site: "Северный" },
      { name: "Соколов В.М.", role: "mechanic", login: "sokolov", site: "Южный" },
      { name: "Лебедев К.П.", role: "mechanic", login: "lebedev", site: "Южный" },
    ].map((s) => ({ id: uuid(), active: true, pending: false, owner: !!s.owner, created_at: iso(Date.now() - 40 * 86400000), last_seen: null, pin: PIN, ...s }));
    const models = ["Самосвал 90 т", "Самосвал 130 т", "Самосвал 220 т", "Экскаватор 12 м³", "Бульдозер", "Погрузчик колёсный", "Автогрейдер", "Поливочная машина"];
    const machines = [];
    for (let i = 0; i < 36; i++) machines.push({ gar: String(100 + i * 3 + (i % 2)), model: models[i < 20 ? i % 3 : 3 + (i % 5)], active: true, warranty_end: null });
    const workers = ["Алексеев Н.Г.", "Белов Р.А.", "Васильев О.Д.", "Григорьев П.Е.", "Данилов С.С.", "Егоров М.В.", "Жуков А.И.", "Зайцев Т.Н.",
      "Ильин В.К.", "Комаров Ю.Л.", "Макаров Г.Ф.", "Никитин Е.А.", "Осипов Д.Р.", "Павлов Б.С.", "Романов И.М.", "Семёнов А.Ю."]
      .map((name, i) => ({ id: uuid(), name, grp: ["слесарь", "слесарь", "сварщик", "механик", "слесарь", "инженер"][i % 6], active: true, created_at: iso(Date.now() - 40 * 86400000) }));

    const FAULTS = {
      "Ремонт": ["Течь масла из-под клапанной крышки", "Не работает стеклоочиститель", "Утечка по РВД рулевого управления", "Ошибка датчика скорости колеса",
        "Перегрев ДВС", "Не заводится, разряжена АКБ", "Стук в районе ступицы", "Течь ОЖ из-под водяного насоса", "Ослаблено крепление топливного бака",
        "Залом болта выпускного коллектора", "Не работает кондиционер", "Падение давления в гидросистеме"],
      "ТО": ["Плановое ТО-250", "Плановое ТО-500", "Плановое ТО-1000", "ТО-0 после ремонта"],
      "Долив": ["Долив масла ДВС", "Долив ОЖ", "Долив гидравлического масла"],
      "Диагностика": ["Ошибка на бортовом мониторе", "Посторонний шум при работе", "Проверка после замечания водителя"],
    };
    const WORK = {
      "Ремонт": ["Замена РВД", "Замена уплотнения", "Ремонт электропроводки", "Замена датчика", "Сварочные работы", "Протяжка резьбовых соединений",
        "Замена приводного ремня", "Чистка контактов разъёмов", "Замена водяного насоса", "Удаление залома болта. Установка нового болта"],
      "ТО": ["Замена масляных фильтров ДВС", "Замена топливных фильтров", "Замена фильтров системы охлаждения", "Протяжка резьбовых соединений"],
      "Долив": ["Доливка масла", "Доливка охлаждающей жидкости"],
      "Диагностика": ["Диагностика с помощью сканера", "Диагностика электрооборудования", "Диагностика гидравлической системы"],
    };
    const DUR = { "Ремонт": [1.2, 9], "ТО": [5, 10], "Долив": [0.3, 1], "Диагностика": [0.7, 3] };
    const WAITS = ["Нет водителя", "Распоряжение диспетчера", "Пересменка / обед"];
    const jobs = [], now = Date.now();
    const bySite = (site) => ({ mech: staff.filter((s) => s.site === site && s.role === "mechanic"), cars: site === "Северный" ? machines.slice(0, 22) : machines.slice(22) });
    const busy = new Map();   // машина -- до какого времени занята (без наложений)
    function job(site, start, kind, opts = {}) {
      const { mech, cars } = bySite(site);
      let gar = opts.gar; for (let k = 0; !gar && k < 20; k++) { const g = pick(cars).gar; if ((busy.get(g) || 0) < start) gar = g; }
      if (!gar) return null;
      const m = pick(mech), [a, b] = DUR[kind];
      let len = between(a, b) * H; if (kind === "Ремонт" && R() < 0.07) len = between(18, 40) * H;   // редкий долгострой
      const wait = !opts.open && kind !== "Долив" && R() < 0.22 ? between(0.3, 3.2) * H : 0;
      const end = opts.open ? null : start + len + wait;
      busy.set(gar, end || Infinity);
      const ws = [...new Set([pick(workers).name, ...(R() < 0.5 ? [pick(workers).name] : [])])];
      const work = pick(WORK[kind]);
      const from = new Date(start + 20 * MIN), to = end ? new Date(start + len) : null, p2 = (n) => String(n).padStart(2, "0");
      const j = {
        id: uuid(), client_id: "app:" + uuid(), gar, kind, area: kind === "ТО" ? "ТО" : "Площадка", site,
        started_at: iso(start), ended_at: end ? iso(end) : null, fault: pick(FAULTS[kind]), work: end || R() < 0.5 ? work : "",
        moto: Math.round(between(8000, 42000)), tmc: kind === "ТО" ? "Фильтр масляный — 2 шт.\nФильтр топливный — 2 шт." : "", note: "",
        mechanic_id: m.id, mechanic_name: m.name, deleted: false, deleted_at: null, deleted_by: null, was_imported: false,
        ready_at: wait ? iso(start + len) : opts.ready ? iso(now - opts.ready) : null,
        wait_reason: wait || opts.ready ? pick(WAITS) : null, crew: ws.length, workers: ws,
        steps: end ? [{ t: work, from: `${p2(from.getHours())}:${p2(from.getMinutes())}`, to: to ? `${p2(to.getHours())}:${p2(to.getMinutes())}` : "", who: ws }] : null,
        inspect: kind === "ТО" && end ? { ac: "ok", pzd: "ok", ansul: "ok", heat: R() < 0.2 ? "bad" : "ok", uspvl: "ok", lv: "1,2", ln: "1,1", pv: "1,3", pn: "1,2" } : null,
        rev: 1 + Math.floor(R() * 3), imported_rev: 0, imported_at: null,
      };
      const last = end || start;
      j.created_at = iso(start + Math.round(between(3, 25)) * MIN); j.updated_at = iso(Math.min(now - MIN, last + 5 * MIN));
      // в Excel-книгу перенесено всё, кроме последних часов
      if (now - last > 3 * H && site === "Северный") { j.imported_rev = j.rev; j.imported_at = iso(last + H); }
      jobs.push(j); return j;
    }
    const KIND = () => { const x = R(); return x < 0.55 ? "Ремонт" : x < 0.72 ? "ТО" : x < 0.88 ? "Долив" : "Диагностика"; };
    for (const site of SITES) {
      const perDay = site === "Северный" ? 9 : 5;
      for (let d = 30; d >= 0; d--) {
        const n = Math.round(perDay * between(0.6, 1.3));
        for (let i = 0; i < n; i++) {
          const start = now - d * 86400000 - between(0, 24) * H;
          if (start > now - 2 * H) continue;
          const j = job(site, start, KIND());
          if (j && j.ended_at && new Date(j.ended_at) > now) {   // ещё не закончилась -- открыта
            j.ended_at = null; j.work = ""; j.steps = null; j.ready_at = null; j.wait_reason = null; j.imported_rev = 0; j.imported_at = null;
          }
        }
      }
      // сейчас на площадке: свежие заезды, одна «готова, ждёт», один долгострой
      job(site, now - 50 * MIN, "Ремонт", { open: true });
      job(site, now - 2.5 * H, "Ремонт", { open: true, ready: 35 * MIN });
      job(site, now - 3 * H, "ТО", { open: true });
      if (site === "Северный") { job(site, now - 26 * H, "Ремонт", { open: true }); job(site, now - 20 * MIN, "Долив", { open: true }); }
    }
    const tmc = [];
    const parts = ["Фильтр масляный", "Фильтр топливный тонкой очистки", "Фильтр топливный грубой очистки", "Фильтр воздушный", "Фильтр гидравлический",
      "Ремень приводной", "РВД 1/2\" 1200 мм", "РВД 3/4\" 900 мм", "Уплотнительное кольцо 32×3", "Датчик скорости колеса", "Датчик давления масла",
      "Реле 24 В", "Предохранитель 30 А", "Щётка стеклоочистителя", "Насос водяной", "Термостат", "Болт М12×40", "Хомут червячный 60–80",
      "Масло моторное 15W-40, л", "Масло гидравлическое, л", "Охлаждающая жидкость, л", "Смазка пластичная, кг", "Лампа фары 24 В", "АКБ 190 А·ч"];
    parts.forEach((p, i) => tmc.push([`ДМ-${String(10000 + i * 37)}`, `${(i * 7919 % 90000) + 10000}-${i % 9}`, p].join("\t")));
    return { staff, machines, workers, jobs, photos: [], invite: { id: 1, code: "DEMO26" }, tmc: tmc.join("\n"), created: Date.now() };
  }

  // первое открытие: «новым» считается только последнее (иначе вся история -- непросмотренная)
  if (!localStorage.getItem("rz_seen")) localStorage.setItem("rz_seen", JSON.stringify(Date.now() - 90 * 60000));
  let db;
  try { db = JSON.parse(localStorage.getItem(DB_KEY)); } catch {}
  if (!db || !db.jobs) { db = seed(); persist(); }
  function persist() { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch {} }
  const blobs = new Map();   // фото -- только на время открытой вкладки

  // ---------- вход ----------
  const session = () => { try { const s = JSON.parse(localStorage.getItem(AUTH_KEY)); return s && db.staff.some((x) => x.id === s.user?.id) ? s : null; } catch { return null; } };
  const me = () => { const s = session(); return s && db.staff.find((x) => x.id === s.user.id); };
  const authCbs = [];

  // ---------- Realtime ----------
  const channels = new Set();
  function emit(table, eventType, row, old) {
    const pub = row && table === "jobs" ? visibleJob(row) : true;
    if (!pub) return;
    for (const ch of channels) for (const l of ch.ls) if (l.type === "postgres_changes" && l.f.table === table)
      setTimeout(() => l.cb({ eventType, new: row ? clone(row) : {}, old: old ? clone(old) : {} }), 120);
  }
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const visibleJob = (j) => { const m = me(); return !!m && j.site === m.site; };

  // ---------- правила записи jobs (как триггер на сервере) ----------
  const BIZ = ["gar", "kind", "started_at", "ended_at", "fault", "work", "moto", "tmc", "note", "deleted", "mechanic_id", "ready_at", "wait_reason", "crew", "workers"];
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  function jobInsert(row) {
    const m = me(), now = iso(Date.now());
    const j = { id: uuid(), deleted: false, steps: null, inspect: null, workers: null, crew: null, ...row };
    if (!j.mechanic_id || m?.role !== "admin") j.mechanic_id = m?.id;
    j.mechanic_name = db.staff.find((s) => s.id === j.mechanic_id)?.name || null;
    j.site = m?.site || j.site; j.rev = 1; j.imported_rev = 0; j.imported_at = null; j.was_imported = false;
    j.deleted_at = j.deleted ? now : null; j.deleted_by = j.deleted ? j.mechanic_name : null; j.created_at = now; j.updated_at = now;
    return j;
  }
  function jobUpdate(old, patch) {
    const m = me(), n = { ...old, ...patch }, now = iso(Date.now());
    if (n.deleted && !old.deleted) {
      if (m?.role !== "admin" && old.mechanic_id !== m?.id) throw err("Удалить чужую запись может только администратор");
      n.deleted_at = now; n.was_imported = old.imported_rev > 0; n.deleted_by = m?.name || null;
    } else if (old.deleted && !n.deleted) {
      if (m?.role !== "admin" && old.mechanic_id !== m?.id) throw err("Вернуть чужую запись может только администратор");
      n.deleted_at = null; n.deleted_by = null; n.was_imported = false;
      if (!n.ended_at || !old.was_imported) { n.imported_rev = 0; n.imported_at = null; }
    }
    n.site = old.site;
    if (old.steps && same(n.steps, old.steps) && (!same(n.work, old.work) || !same(n.workers, old.workers))) n.steps = null;
    if (BIZ.some((k) => !same(n[k], old[k]))) { n.rev = old.rev + 1; n.updated_at = now; }
    else if (!same(n.inspect, old.inspect)) n.updated_at = now;
    n.mechanic_name = n.mechanic_id !== old.mechanic_id ? db.staff.find((s) => s.id === n.mechanic_id)?.name : old.mechanic_name;
    if (!(old.deleted && !n.deleted)) { n.imported_rev = old.imported_rev; n.imported_at = old.imported_at; }
    return n;
  }
  const err = (message, extra = {}) => Object.assign(new Error(message), { message, ...extra });

  // ---------- запросы к таблицам ----------
  const KEYS = { jobs: "id", machines: "gar", workers: "id", staff: "id", photos: "id" };
  function rows(table) {
    if (table === "invite") return [db.invite];
    const t = db[table] || [];
    const m = me();
    if (table === "jobs") return m ? t.filter((j) => j.site === m.site) : [];
    if (table === "staff") return t.map(({ pin, ...s }) => s);
    return t;
  }
  function parseVal(v) { return v === "null" ? null : v === "true" ? true : v === "false" ? false : v; }
  function test(r, [op, col, val]) {
    const x = r[col];
    switch (op) {
      case "eq": return same(x, val);
      case "neq": return !same(x, val);
      case "gte": return x != null && x >= val;
      case "gt": return x != null && x > val;
      case "lte": return x != null && x <= val;
      case "lt": return x != null && x < val;
      case "is": return val === null ? x == null : x === val;
      case "notis": return val === null ? x != null : x !== val;
      case "in": return val.includes(x);
      case "or": return val.some((f) => test(r, f));
      default: return true;
    }
  }
  class Q {
    constructor(table) { this.t = table; this.op = "select"; this.f = []; this.o = []; this.n = 0; this.one = ""; this.ret = false; }
    select() { if (this.op === "select") this.op = "select"; else this.ret = true; return this; }
    insert(d) { this.op = "insert"; this.d = d; return this; }
    upsert(d, opt = {}) { this.op = "upsert"; this.d = d; this.oc = opt.onConflict; return this; }
    update(d) { this.op = "update"; this.d = d; return this; }
    delete() { this.op = "delete"; return this; }
    eq(c, v) { this.f.push(["eq", c, v]); return this; }
    neq(c, v) { this.f.push(["neq", c, v]); return this; }
    gte(c, v) { this.f.push(["gte", c, v]); return this; }
    gt(c, v) { this.f.push(["gt", c, v]); return this; }
    lte(c, v) { this.f.push(["lte", c, v]); return this; }
    lt(c, v) { this.f.push(["lt", c, v]); return this; }
    is(c, v) { this.f.push(["is", c, v]); return this; }
    in(c, v) { this.f.push(["in", c, v]); return this; }
    not(c, op, v) { if (op === "is") this.f.push(["notis", c, v]); return this; }
    or(s) { this.f.push(["or", null, s.split(",").map((p) => { const [c, op, ...v] = p.split("."); return [op, c, parseVal(v.join("."))]; })]); return this; }
    order(c, opt = {}) { this.o.push([c, opt.ascending !== false]); return this; }
    limit(n) { this.n = n; return this; }
    single() { this.one = "single"; return this; }
    maybeSingle() { this.one = "maybe"; return this; }
    then(ok, bad) { return new Promise((r) => setTimeout(() => r(this.run()), 60 + Math.random() * 120)).then(ok, bad); }
    run() {
      try {
        let out;
        if (this.op === "select") {
          out = rows(this.t).filter((r) => this.f.every((f) => test(r, f)));
          for (const [c, asc] of [...this.o].reverse()) out.sort((a, b) => (a[c] ?? "") < (b[c] ?? "") ? (asc ? -1 : 1) : (a[c] ?? "") > (b[c] ?? "") ? (asc ? 1 : -1) : 0);
          if (this.n) out = out.slice(0, this.n);
          out = clone(out);
        } else out = this.write();
        persist();
        if (this.one) {
          if (out.length !== 1 && (this.one === "single" || out.length > 1)) return { data: null, error: { code: "PGRST116", message: "Запись не найдена" }, status: 406 };
          return { data: out[0] || null, error: null, status: 200 };
        }
        return { data: out, error: null, status: 200 };
      } catch (e) { return { data: null, error: { message: e.message, code: e.code || "P0001" }, status: 400 }; }
    }
    write() {
      const t = this.t, key = KEYS[t], list = db[t], m = me();
      if (!m) throw err("нет доступа");
      if (t !== "jobs" && m.role !== "admin" && t !== "photos") throw err("Только администратор");
      const res = [];
      if (this.op === "update" || this.op === "delete") {
        for (const r of rows(t).filter((x) => this.f.every((f) => test(x, f)))) {
          const i = list.findIndex((x) => x[key] === r[key]);
          if (this.op === "delete") { const [o] = list.splice(i, 1); emit(t, "DELETE", null, o); continue; }
          const n = t === "jobs" ? jobUpdate(list[i], this.d) : { ...list[i], ...this.d };
          list[i] = n; res.push(clone(n)); emit(t, "UPDATE", n, r);
        }
        return res;
      }
      for (const d of [].concat(this.d)) {
        const ck = this.oc || key, i = this.op === "upsert" && d[ck] != null ? list.findIndex((x) => x[ck] === d[ck]) : -1;
        if (i >= 0) { const o = list[i], n = t === "jobs" ? jobUpdate(o, d) : { ...o, ...d }; list[i] = n; res.push(clone(n)); emit(t, "UPDATE", n, o); }
        else {
          const n = t === "jobs" ? jobInsert(d) : { ...(key === "id" ? { id: uuid() } : {}), created_at: iso(Date.now()), ...d };
          list.push(n); res.push(clone(n)); emit(t, "INSERT", n);
        }
      }
      return res;
    }
  }

  // ---------- серверные функции ----------
  const login = (s) => ({ name: s.name, login: s.login, role: s.role });
  const RPC = {
    staff_exists: () => true,
    login_find: ({ p_name }) => {
      const q = String(p_name || "").trim().split(/\s+/)[0].toLowerCase().replace(/ё/g, "е");
      return db.staff.filter((s) => s.active && q.length >= 2 && s.name.split(" ")[0].toLowerCase().replace(/ё/g, "е") === q).map(login);
    },
    seen: () => { const m = me(); if (m) { db.staff.find((s) => s.id === m.id).last_seen = iso(Date.now()); } return null; },
    set_my_site: ({ p_site }) => { const m = me(); if (!SITES.includes(p_site)) throw err("Нет такого участка"); db.staff.find((s) => s.id === m.id).site = p_site; return null; },
    tmc_list: () => ({ at: iso(db.created), data: db.tmc }),
    push_save: () => null, push_drop: () => null,
    photo_add: ({ p_job, p_path }) => {
      const m = me(), j = db.jobs.find((x) => x.id === p_job);
      const p = { id: uuid(), job_id: p_job, path: p_path, gar: j?.gar, kind: j?.kind, site: j?.site, staff_id: m.id, staff_name: m.name, created_at: iso(Date.now()), downloaded_at: null };
      db.photos.push(p); emit("photos", "INSERT", p); return clone(p);
    },
    photo_del: ({ p_id }) => { const i = db.photos.findIndex((p) => p.id === p_id); if (i >= 0) { const [o] = db.photos.splice(i, 1); emit("photos", "DELETE", null, o); } return null; },
  };
  function staffAdmin(b) {
    const m = me(), owner = m?.owner, find = (id) => db.staff.find((s) => s.id === id);
    const mkLogin = (name) => "u" + Math.random().toString(36).slice(2, 8);
    switch (b.action) {
      case "signup": {
        if (String(b.code).toUpperCase() !== db.invite.code) throw err("Неверный код приглашения (в демо: " + db.invite.code + ")");
        if (db.staff.some((s) => s.name === b.name)) throw err("Такой сотрудник уже есть");
        const s = { id: uuid(), name: b.name, role: "mechanic", login: mkLogin(), active: true, pending: false, owner: false, site: b.site, pin: b.pin, created_at: iso(Date.now()), last_seen: null };
        db.staff.push(s); return { login: s.login };
      }
      case "bootstrap": throw err("В демо администратор уже создан");
    }
    if (m?.role !== "admin") throw err("Только администратор");
    switch (b.action) {
      case "new_code": db.invite.code = Math.random().toString(36).slice(2, 8).toUpperCase(); return { code: db.invite.code };
      case "create": {
        if (db.staff.some((s) => s.name === b.name)) throw err("Такой сотрудник уже есть");
        const s = { id: uuid(), name: b.name, role: b.role || "mechanic", login: mkLogin(), active: true, pending: false, owner: false, site: m.site, pin: b.pin, created_at: iso(Date.now()), last_seen: null };
        db.staff.push(s); return { ok: true, login: s.login };
      }
      case "set_pin": find(b.id).pin = b.pin; return { ok: true };
      case "set_active": { const s = find(b.id); s.active = !!b.active; s.pending = false; return { ok: true }; }
      case "reject": { db.staff = db.staff.filter((s) => s.id !== b.id); return { ok: true }; }
      case "approve": case "activate": { const s = find(b.id); s.active = true; s.pending = false; return { ok: true }; }
      case "update": { if (!owner) throw err("Только владелец"); Object.assign(find(b.id), { name: b.name, role: b.role, site: b.site }); return { ok: true }; }
      case "delete": { if (!owner) throw err("Только владелец"); if (b.id === m.id) throw err("Себя удалить нельзя"); db.staff = db.staff.filter((s) => s.id !== b.id); return { ok: true }; }
      default: { const s = find(b.id); if (s) { s.active = true; s.pending = false; } return { ok: true }; }
    }
  }
  const later = (v) => new Promise((r) => setTimeout(() => r(v), 80 + Math.random() * 150));

  const client = {
    from: (t) => new Q(t),
    rpc: (name, args = {}) => {
      try { const f = RPC[name]; if (!f) throw err("нет функции " + name); const data = f(args); persist(); return later({ data, error: null }); }
      catch (e) { return later({ data: null, error: { message: e.message } }); }
    },
    functions: {
      invoke: (name, { body } = {}) => {
        try { const data = staffAdmin(body || {}); persist(); return later({ data, error: null }); }
        catch (e) { return later({ data: null, error: { message: e.message, context: { json: async () => ({ error: e.message }) } } }); }
      },
    },
    auth: {
      getSession: () => later({ data: { session: session() }, error: null }),
      signInWithPassword: ({ email, password }) => {
        const lg = String(email).split("@")[0], s = db.staff.find((x) => x.login === lg && x.active);
        const pin = String(password).split("-")[1];
        if (!s || s.pin !== pin) return later({ data: {}, error: { message: "Invalid login credentials", status: 400 } });
        const ses = { user: { id: s.id }, access_token: "demo" };
        localStorage.setItem(AUTH_KEY, JSON.stringify(ses)); authCbs.forEach((cb) => cb("SIGNED_IN", ses));
        return later({ data: { session: ses }, error: null });
      },
      signOut: () => { localStorage.removeItem(AUTH_KEY); authCbs.forEach((cb) => cb("SIGNED_OUT", null)); return later({ error: null }); },
      onAuthStateChange: (cb) => { authCbs.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
    },
    storage: {
      from: () => ({
        upload: (path, blob) => { blobs.set(path, blob); return later({ data: { path }, error: null }); },
        remove: (paths) => { paths.forEach((p) => blobs.delete(p)); return later({ data: [], error: null }); },
        createSignedUrls: (paths) => later({ data: paths.map((p) => ({ path: p, signedUrl: blobs.has(p) ? URL.createObjectURL(blobs.get(p)) : DEMO_PHOTO })), error: null }),
      }),
    },
    channel: (name, opt = {}) => {
      const ch = {
        name, ls: [], key: opt.config?.presence?.key,
        on(type, f, cb) { this.ls.push({ type, f, cb }); return this; },
        subscribe(cb) { channels.add(this); setTimeout(() => cb && cb("SUBSCRIBED"), 200); return this; },
        track() { presence.add(this.key); syncPresence(); return Promise.resolve("ok"); },
        presenceState() { return Object.fromEntries([...presence].map((k) => [k, [{}]])); },
      };
      return ch;
    },
    removeChannel: (ch) => { channels.delete(ch); if (ch.key) { presence.delete(ch.key); } return Promise.resolve("ok"); },
  };
  const DEMO_PHOTO = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#8E8E93"/><text x="400" y="310" font-family="sans-serif" font-size="34" fill="#fff" text-anchor="middle">Фото (демо)</text></svg>`);

  // кто «в приложении»: я + 1–2 вымышленных коллеги участка
  const presence = new Set();
  function syncPresence() {
    const m = me(); if (!m) return;
    db.staff.filter((s) => s.site === m.site && s.id !== m.id && s.role === "mechanic").slice(0, 2).forEach((s) => presence.add(s.id));
    for (const ch of channels) for (const l of ch.ls) if (l.type === "presence") setTimeout(l.cb, 50);
  }

  // ---------- «книга Excel»: раз в 25 с переносит записи участка Северный (как кнопка «Из приложения» в книге) ----------
  setInterval(() => {
    const now = iso(Date.now());
    for (const j of db.jobs) if (j.site === "Северный" && !j.deleted && j.rev > j.imported_rev && Date.now() - new Date(j.updated_at) > 20000) {
      const o = { ...j }; j.imported_rev = j.rev; j.imported_at = now; emit("jobs", "UPDATE", j, o);
    }
    persist();
  }, 25000);

  // ---------- живая имитация: коллеги делают записи (заезд, готова-ждёт, выезд) ----------
  const DEMO = window.REMZONA_DEMO = {
    live: localStorage.getItem("rzd_live") !== "0",
    setLive(v) { this.live = v; localStorage.setItem("rzd_live", v ? "1" : "0"); },
    reset() { localStorage.removeItem(DB_KEY); localStorage.removeItem(AUTH_KEY); ["rz_me", "rz_jobs", "rz_queue", "rz_machines", "rz_workers", "rz_pick", "rz_seen", "rz_price", "rz_shift"].forEach((k) => localStorage.removeItem(k)); location.reload(); },
    accounts: () => db.staff.filter((s) => s.active).map((s) => ({ ...login(s), site: s.site })),
    pin: PIN,
  };
  function tick() {
    setTimeout(tick, 35000 + Math.random() * 40000);
    const m = me(); if (!DEMO.live || !m || document.hidden) return;
    const R = Math.random, others = db.staff.filter((s) => s.site === m.site && s.role === "mechanic" && s.id !== m.id);
    if (!others.length) return;
    const who = others[Math.floor(R() * others.length)], open = db.jobs.filter((j) => j.site === m.site && !j.deleted && !j.ended_at), theirs = open.filter((j) => j.mechanic_id !== m.id);
    const nowI = iso(Date.now()), x = R();
    if (x < 0.45 || open.length < 3) {
      const cars = db.machines.filter((c) => !open.some((j) => j.gar === c.gar) && db.jobs.some((j) => j.gar === c.gar && j.site === m.site));
      if (!cars.length) return;
      const c = cars[Math.floor(R() * cars.length)], kind = R() < 0.7 ? "Ремонт" : "Долив";
      const j = { id: uuid(), client_id: "app:" + uuid(), gar: c.gar, kind, area: "Площадка", site: m.site, started_at: iso(Date.now() - 4 * MIN),
        ended_at: null, fault: kind === "Долив" ? "Долив масла ДВС" : ["Течь по РВД", "Не работает фара", "Ошибка датчика давления", "Стук при повороте"][Math.floor(R() * 4)],
        work: "", moto: Math.round(10000 + R() * 30000), tmc: "", note: "", mechanic_id: who.id, mechanic_name: who.name, deleted: false, deleted_at: null, deleted_by: null,
        was_imported: false, ready_at: null, wait_reason: null, crew: null, workers: null, steps: null, inspect: null, rev: 1, imported_rev: 0, imported_at: null, created_at: nowI, updated_at: nowI };
      db.jobs.push(j); emit("jobs", "INSERT", j);
    } else {
      if (!theirs.length) return;
      const j = theirs[Math.floor(R() * theirs.length)], o = { ...j };
      if (!j.ready_at && R() < 0.35 && j.kind !== "Долив") { j.ready_at = nowI; j.wait_reason = ["Нет водителя", "Распоряжение диспетчера"][Math.floor(R() * 2)]; }
      else { j.ended_at = nowI; j.work = j.kind === "Долив" ? "Доливка масла" : "Замена уплотнения"; j.workers = [db.workers[Math.floor(R() * db.workers.length)].name]; j.crew = 1; }
      j.rev++; j.updated_at = nowI; j.mechanic_id = j.mechanic_id || who.id; emit("jobs", "UPDATE", j, o);
    }
    persist();
  }
  setTimeout(tick, 20000);

  window.supabase = { createClient: () => client };
})();
