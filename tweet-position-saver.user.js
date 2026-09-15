// ==UserScript==
// @name         X/Twitter Timeline Position Saver
// @namespace    http://tampermonkey.net/
// @version      4.11
// @description  Bookmark and local-date jumps with anti-slip position tracking
// @author       You
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  const PREFIX = "x_pos_tab_";
  const SLIP_DELAY = 10000;
  const COLD_START_WAIT = 30 * 60 * 1000;
  const JUMP_BATCH_SIZE = 5000;
  const JUMP_STALL_WAIT = 15000;
  const UI_KEY = "x_pos_ui";
  let placement = { side: "right", y: 0.3 };
  try {
    const stored = JSON.parse(localStorage.getItem(UI_KEY));
    if (stored && ["left", "right"].includes(stored.side) &&
        Number.isFinite(stored.y) && stored.y >= 0 && stored.y <= 1) placement = stored;
  } catch { /* An unavailable or malformed preference must not hide the controls. */ }

  let jumping = false;
  let jumpStatus = "↓ Jump";
  let jumpSearch = null;
  let selectedDate = "";
  let autoSavePaused = false;
  let dismissed = false;
  let bar = null;
  let panelOpen = false;
  let flashTimer = null;
  let scrollTimer = null;
  let antiSlipTimer = null;
  let coldStartTimer = null;
  let session = { path: null, key: null, tabText: null };

  let isReadingActive = false;
  let lastCommittedId = null;
  let pendingId = null;

  const idToIndex = new Map();
  let maxIdx = 0;
  const listEntries = new Map();

  // Observe only List responses. Never replay requests or change their bodies.
  // Repost dates live on the outer tweet; sortIndex is an ordering key, not a date.
  function listRequestKey(input) {
    try {
      const url = new URL(input?.url || input, window.location.href);
      if (!/(^|\.)(x|twitter)\.com$/.test(url.hostname) ||
          !/\/graphql\/[^/]+\/ListLatestTweetsTimeline$/.test(url.pathname)) return null;
      const id = JSON.parse(url.searchParams.get("variables"))?.listId;
      return /^\d+$/.test(id) ? "list_" + id : null;
    } catch { return null; }
  }

  function timelineTweet(content) {
    let tweet = content?.tweet_results?.result;
    if (tweet?.__typename === "TweetWithVisibilityResults") tweet = tweet.tweet;
    const time = Date.parse(tweet?.legacy?.created_at);
    if (!tweet?.rest_id || !Number.isFinite(time)) return null;
    let original = tweet.legacy.retweeted_status_result?.result;
    if (original?.__typename === "TweetWithVisibilityResults") original = original.tweet;
    if (tweet.legacy.retweeted_status_result && !original?.rest_id) return null;
    return { id: original?.rest_id || tweet.rest_id, time };
  }

  function captureListResponse(key, data) {
    const instructions = data?.data?.list?.tweets_timeline?.timeline?.instructions;
    if (!Array.isArray(instructions)) return;
    let cache = listEntries.get(key);
    if (!cache) {
      cache = { entries: new Map(), byTweet: new Map() };
      listEntries.set(key, cache);
    }
    function remove(entryId) {
      const old = cache.entries.get(entryId);
      for (const member of old?.members || []) {
        const entries = cache.byTweet.get(member.id);
        entries?.delete(entryId);
        if (!entries?.size) cache.byTweet.delete(member.id);
      }
      cache.entries.delete(entryId);
    }
    function store(entryId, members, ignored = false) {
      remove(entryId);
      if (!members.length || members.some(m => !m)) return;
      // A conversation's newest member is its timeline anchor; earlier members
      // are context, even when their dates happen to match the requested day.
      const primary = members.reduce((a, b) => b.time >= a.time ? b : a);
      const entry = { entryId, members, primary, ignored };
      cache.entries.set(entryId, entry);
      for (const member of members) {
        if (!cache.byTweet.has(member.id)) cache.byTweet.set(member.id, new Map());
        cache.byTweet.get(member.id).set(entryId, entry);
      }
    }
    for (const instruction of instructions) {
      if (instruction.type === "TimelineRemoveEntries") {
        for (const id of instruction.entryIds || []) remove(id);
      }
      if (instruction.type === "TimelineAddToModule") {
        const old = cache.entries.get(instruction.moduleEntryId);
        if (old) store(old.entryId, [...old.members,
          ...(instruction.moduleItems || []).map(i => timelineTweet(i.item?.itemContent))], old.ignored);
      }
      const entries = instruction.entries || (instruction.entry ? [instruction.entry] : []);
      for (const entry of entries) {
        const content = entry.content;
        if (!entry.entryId || !content) continue;
        const ignored = instruction.type === "TimelinePinEntry" || !!content.itemContent?.promotedMetadata;
        if (content.itemContent) {
          store(entry.entryId, [timelineTweet(content.itemContent)], ignored);
        } else if (content.displayType === "VerticalConversation" && Array.isArray(content.items)) {
          store(entry.entryId, content.items.map(i => timelineTweet(i.item?.itemContent)), ignored);
        }
      }
    }
  }

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const key = listRequestKey(args[0]);
    const response = originalFetch.apply(this, args);
    if (key) response.then(r => {
      if (r.ok) return r.clone().json().then(data => captureListResponse(key, data));
    }).catch(() => {}); // Observing a response must never break X's request.
    return response;
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    const result = originalOpen.call(this, method, url, ...args);
    const key = listRequestKey(url);
    if (key) this.addEventListener("loadend", () => {
      try {
        if (this.status < 200 || this.status >= 300) return;
        const data = this.responseType === "json" ? this.response :
          !this.responseType || this.responseType === "text" ? JSON.parse(this.responseText) : null;
        captureListResponse(key, data);
      } catch { /* Unsupported responses leave date lookup unavailable. */ }
    }, { once: true });
    return result;
  };

  function dateEntry(article, id) {
    const candidates = listEntries.get(session.key)?.byTweet.get(id);
    if (!candidates?.size) return null;
    if (candidates.size === 1) return candidates.values().next().value;
    // A displayed tweet can be reposted more than once or also appear as context.
    // Prefer the surrounding React entry key; never guess between occurrences.
    const fiberKey = Object.keys(article).find(k => k.startsWith("__reactFiber$"));
    let fiber = article[fiberKey];
    for (let i = 0; fiber && i < 80; i++, fiber = fiber.return) {
      for (const entry of candidates.values()) {
        if (fiber.key === entry.entryId || fiber.key?.startsWith(entry.entryId + "-")) return entry;
      }
    }
    if (Array.from(candidates.values()).every(e => e.primary.id !== id || e.ignored)) {
      return { ignored: true };
    }
    return null;
  }

  function localDate(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function dateRange(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "2006-03-21" || value > localDate()) return null;
    const [year, month, day] = value.split("-").map(Number);
    const start = new Date(year, month - 1, day);
    if (localDate(start) !== value) return null;
    // Construct the next local midnight, not +24 hours (DST days can differ).
    return { start: start.getTime(), end: new Date(year, month - 1, day + 1).getTime() };
  }

  function getActiveTabKey() {
    const path = window.location.pathname;
    const directMatch = path.match(/^\/i\/lists\/(\d+)/);
    let key = null;
    let tabText = null;
    if (directMatch) {
      key = "list_" + directMatch[1];
    } else if (path === "/home" || path === "/") {
      const t = document.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]');
      // X can unmount the tab strip while scrolling. Missing DOM is not a tab switch.
      if (!t && path === session.path) return session.key;
      if (t) {
        tabText = t.innerText.trim();
        if (!tabText && path === session.path) return session.key;
        if (tabText && tabText !== "For you" && tabText !== "Following") {
          const href = t.getAttribute("href") || t.closest("a")?.getAttribute("href") || "";
          const listMatch = href.match(/\/i\/lists\/(\d+)/);
          key = listMatch ? "list_" + listMatch[1] : "text_" + tabText.replace(/\s+/g, "_");
          // Keep the same storage key if a re-render adds or removes the tab's href.
          if (path === session.path && tabText === session.tabText &&
              (!listMatch || session.key?.startsWith("text_"))) {
            key = session.key;
          }
        }
      }
    }

    if (path !== session.path || key !== session.key) {
      session = { path, key, tabText };
      clearTrackingTimers();
      jumping = false;
      jumpStatus = "↓ Jump";
      jumpSearch = null;
      autoSavePaused = false;
      dismissed = false;
      panelOpen = false;
      isReadingActive = false;
      lastCommittedId = key ? localStorage.getItem(PREFIX + key) : null;
      idToIndex.clear();
      maxIdx = 0;
      if (bar) { bar.remove(); bar = null; }
    } else {
      session.tabText = tabText;
    }
    return key;
  }

  function isCurrentSession(expected) {
    return getActiveTabKey() !== null && session === expected;
  }

  function clearTrackingTimers() {
    clearTimeout(scrollTimer);
    clearTimeout(coldStartTimer);
    clearTimeout(antiSlipTimer);
    pendingId = null;
    updateReturnButton(false);
  }

  function idOf(article) {
    const links = Array.from(article.querySelectorAll('a[href*="/status/"]'));
    for (const link of links) {
      if (link.closest('div[role="link"][tabindex="0"]')) continue;
      const match = link.href.match(/\/status\/(\d+)/);
      if (match) return match[1];
    }
    return null;
  }

  function topId() {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    for (const a of articles) {
      if (a.offsetHeight === 0) continue;
      const r = a.getBoundingClientRect();
      if (r.top >= 80 || r.bottom > 130) return idOf(a);
    }
    return null;
  }

  function saved() { 
    const k = getActiveTabKey();
    return k ? localStorage.getItem(PREFIX + k) : null; 
  }
  
  function persist(id, expected = session) {
    if (id && isCurrentSession(expected)) {
      localStorage.setItem(PREFIX + expected.key, id);
      lastCommittedId = id;
      updateReturnButton(false);
    }
  }

  function scanTimeline() {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    for (const a of articles) {
      if (a.offsetHeight === 0) continue;
      const id = idOf(a);
      if (id && !idToIndex.has(id)) {
        idToIndex.set(id, ++maxIdx);
      }
    }
  }

  function refreshLabel() {
    if (!bar) return;
    scanTimeline();
    updateControls();
  }

  function updateControls() {
    if (!bar) return;
    const bookmark = session.key ? localStorage.getItem(PREFIX + session.key) : null;
    const current = topId();
    const count = jumpSearch ? jumpSearch.inspected.size : idToIndex.get(current);
    const readingStatus = pendingId ? "Waiting for a stable position" + (lastCommittedId ? " · Back available" : "")
      : "Auto-save active";
    const status = jumping ? jumpStatus : autoSavePaused ? `${jumpStatus} · Auto-save paused`
      : isReadingActive ? readingStatus : bookmark ? "Jump or Save to start auto-saving" : "No bookmark yet · Save to start";
    bar.dataset.mode = jumping ? "searching" : autoSavePaused ? "paused" : isReadingActive ? "reading" : "idle";
    const label = bar.querySelector("#x-pos-lbl");
    const notice = bar.querySelector("#x-pos-notice");
    label.textContent = notice.hidden ? status : notice.textContent;
    const counter = bar.querySelector("#x-pos-count");
    counter.textContent = count == null ? "—" : count < 1000 ? String(count)
      : new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(count).toLowerCase();
    counter.title = jumpSearch ? `${jumpSearch.inspected.size} / ${jumpSearch.limit} inspected · ${status}`
      : count ? `Timeline #${count} · ${status}` : status;
    counter.setAttribute("aria-label", counter.title);
    const main = bar.querySelector("#x-pos-jump");
    setIcon(main, jumping ? "stop" : jumpSearch ? "play" : "jump");
    main.title = jumping ? `Stop · ${jumpStatus}` : jumpSearch ? jumpStatus : "Jump to saved bookmark";
    main.setAttribute("aria-label", main.title);
    main.disabled = !jumping && !jumpSearch && !bookmark;
    if (jumping && ["x-pos-bookmark", "x-pos-date", "x-pos-go"].includes(document.activeElement?.id)) {
      main.focus({ preventScroll: true });
    }
    bar.querySelector("#x-pos-bookmark").disabled = jumping || !bookmark;
    bar.querySelector("#x-pos-date").disabled = jumping;
    bar.querySelector("#x-pos-date").max = localDate();
    bar.querySelector("#x-pos-go").disabled = jumping;
    for (const button of bar.querySelectorAll("[data-save]")) button.disabled = !current;
    const savedLabel = bar.querySelector("#x-pos-saved");
    savedLabel.textContent = bookmark ? "…" + bookmark.slice(-8) : "None";
    savedLabel.title = bookmark || "No saved bookmark";
    bar.querySelector("#x-pos-date-note").textContent = jumping
      ? "Stop the search before choosing another date."
      : "Local time. Reposts use their repost date. Reload X after installing to capture date data.";
    positionUI();
  }

  function onScroll() {
    if (!getActiveTabKey() || jumping || autoSavePaused) return;
    const expected = session;

    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      if (!isCurrentSession(expected) || jumping || autoSavePaused) return;
      const tid = topId();
      if (!tid) return;

      if (!isReadingActive) {
        clearTimeout(coldStartTimer);
        coldStartTimer = setTimeout(() => {
          if (!isCurrentSession(expected) || jumping) return;
          isReadingActive = true;
          persist(tid, expected);
          flash("Session Active", "#1d9bf0");
        }, COLD_START_WAIT);
      } else {
        if (tid === lastCommittedId) {
          clearTimeout(antiSlipTimer);
          pendingId = null;
          updateReturnButton(false);
        } else if (tid !== pendingId) {
          pendingId = tid;
          updateReturnButton(true);
          
          clearTimeout(antiSlipTimer);
          antiSlipTimer = setTimeout(() => {
            if (!isCurrentSession(expected) || jumping) return;
            if (topId() === tid) persist(tid, expected);
            pendingId = null;
            updateReturnButton(false);
          }, SLIP_DELAY);
        }
      }
      refreshLabel();
    }, 400);
  }

  function updateReturnButton(show) {
    const btn = document.getElementById("x-pos-return");
    if (!btn) return;
    btn.hidden = !(show && lastCommittedId);
    positionUI();
  }

  function findArticle(targetId) {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    return Array.from(articles).find(a => a.offsetHeight !== 0 && idOf(a) === targetId);
  }

  function updateJumpButton(text) {
    jumpStatus = text;
    clearTimeout(flashTimer);
    if (bar) bar.querySelector("#x-pos-notice").hidden = true;
    updateControls();
  }

  function stopJump() {
    if (!getActiveTabKey() || !jumping || !jumpSearch) return;
    // Keep the search data but replace its identity: old awaits and cooldowns
    // must not resume, even if Continue is clicked before they finish.
    jumpSearch = { ...jumpSearch };
    jumping = false;
    autoSavePaused = true;
    clearTrackingTimers();
    window.scrollTo({ top: window.scrollY, left: window.scrollX, behavior: "instant" });
    updateJumpButton(`Stopped (${jumpSearch.inspected.size}/${jumpSearch.limit}) · Continue`);
    refreshLabel();
  }

  async function returnToLast() {
    if (!getActiveTabKey() || jumping || !lastCommittedId) return;
    clearTrackingTimers();

    const article = findArticle(lastCommittedId);
    if (article) {
      article.scrollIntoView({ behavior: "auto", block: "center" });
      highlight(article);
      updateReturnButton(false);
    } else {
      // Fast jump logic: determine direction and jump aggressively
      await performJump(lastCommittedId, true);
    }
  }

  function highlight(article) {
    if (!article) return;
    article.style.transition = "background-color 0.4s ease";
    article.style.backgroundColor = "rgba(224, 36, 94, 0.25)";
    setTimeout(() => (article.style.backgroundColor = ""), 2500);
  }

  async function performJump(target, isFast = false) {
    if (!getActiveTabKey() || jumping) return false;
    const expected = session;
    const requestedDay = target.startsWith("date:") ? dateRange(target.slice(5)) : null;
    if (target.startsWith("date:") && !requestedDay) return false;
    clearTrackingTimers();
    jumping = true;
    autoSavePaused = true;

    let search = jumpSearch;
    if (!search || search.target !== target) {
      const day = requestedDay;
      const currentTid = topId();
      const direction = !day && currentTid && BigInt(target) > BigInt(currentTid) ? -1 : 1;
      search = { target, day, direction, isFast, inspected: new Set(), limit: JUMP_BATCH_SIZE };
      jumpSearch = search;
      if (day) {
        // Starting at the top makes this the day's first timeline entry, not just
        // the first matching tweet below the reader's current position.
        window.scrollTo({ top: 0, behavior: "instant" });
      }
    } else if (search.inspected.size >= search.limit) {
      // Continue adds one batch; retrying stalled loading keeps the existing budget.
      search.limit += JUMP_BATCH_SIZE;
    }

    let found = null;
    let missingDateData = false;
    const { direction, inspected, day } = search;
    const label = day ? target.slice(5) : "Searching";
    updateJumpButton(`${label}… ${inspected.size}/${search.limit}`);
    // Show Stop before waiting. A resumed date jump also lets the viewport settle,
    // but does not restart from the top.
    if (day) await new Promise(r => setTimeout(r, 600));
    isFast = search.isFast;
    const step = day ? window.innerHeight * 0.7 : isFast ? window.innerHeight * 4 : window.innerHeight * 2;
    const delay = isFast ? 100 : 600;
    let lastProgressAt = performance.now();
    let lastScrollY = window.scrollY;

    while (true) {
      if (!isCurrentSession(expected) || jumpSearch !== search) return false;
      const previousCount = inspected.size;
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      missingDateData = false;
      for (const article of articles) {
        if (article.offsetHeight === 0) continue;
        const rect = article.getBoundingClientRect();
        if (day && (rect.bottom <= 80 || rect.top >= window.innerHeight)) continue;
        const id = idOf(article);
        if (!id) continue;
        let matches = id === target;
        let entryId = id;
        if (day) {
          const entry = dateEntry(article, id);
          if (!entry) { missingDateData = true; break; }
          if (entry.ignored || entry.primary.id !== id) continue;
          entryId = entry.entryId;
          matches = entry.primary.time >= day.start && entry.primary.time < day.end;
        }
        inspected.add(entryId);
        // A target at the batch boundary still counts as a successful match.
        if (matches) {
          if (day) {
            // Align the actual reply/repost with the reading line, not its parent.
            window.scrollBy({ top: rect.top - 100, behavior: "instant" });
          } else {
            article.scrollIntoView({ behavior: isFast ? "auto" : "smooth", block: "center" });
          }
          highlight(article);
          found = id;
          break;
        }
        if (inspected.size >= search.limit) break;
      }

      updateJumpButton(`${label}… ${inspected.size}/${search.limit}${missingDateData ? " · Waiting for dates" : ""}`);
      if (found || inspected.size >= search.limit) break;

      const now = performance.now();
      const scrollY = window.scrollY;
      if (inspected.size > previousCount || Math.abs(scrollY - lastScrollY) > 1) {
        lastProgressAt = now;
      }
      lastScrollY = scrollY;
      // Slow loading does not consume the tweet budget, but a stuck page can stop.
      if (now - lastProgressAt >= JUMP_STALL_WAIT) break;

      if (!missingDateData) {
        window.scrollBy({ top: step * direction, behavior: day ? "instant" : isFast ? "auto" : "smooth" });
      }
      await new Promise(r => setTimeout(r, delay));
    }

    if (!isCurrentSession(expected) || jumpSearch !== search) return false;
    if (found) autoSavePaused = false;
    updateJumpButton(found ? "✓ Found" : inspected.size >= search.limit
      ? `Not found (${inspected.size}) · Continue`
      : missingDateData ? "Date data unavailable · Retry"
      : `Loading stalled (${inspected.size}) · Retry`);
    setTimeout(() => {
      if (!isCurrentSession(expected) || jumpSearch !== search) return;
      if (found) jumpSearch = null;
      jumping = false;
      updateJumpButton(found ? "↓ Jump" : jumpStatus);
      refreshLabel();
      // Capture reading movement that happened during the smooth-scroll cooldown.
      // Failed searches leave auto-save paused until a successful Jump or Save.
      onScroll();
    }, 1500);
    return found;
  }

  async function jump(target = null) {
    if (!getActiveTabKey() || jumping) return;
    target ||= jumpSearch?.target || saved();
    if (!target) return;
    const expected = session;
    const success = await performJump(target, false); // Normal jump uses smooth sweep
    if (success && isCurrentSession(expected)) {
      isReadingActive = true;
      // A date is a navigation target, never a stored bookmark. Keep the previous
      // commit until the normal anti-slip timer saves the newly reached tweet.
      if (!target.startsWith("date:")) lastCommittedId = success;
      flash("Reading Active", "#1d9bf0");
    }
  }

  function jumpToDate() {
    if (!getActiveTabKey() || jumping) return;
    const input = document.getElementById("x-pos-date");
    if (!input?.reportValidity() || !dateRange(input.value)) return;
    if (!session.key.startsWith("list_")) {
      input.setCustomValidity("Open this List directly so its ID can be identified.");
      input.reportValidity();
      return;
    }
    selectedDate = input.value;
    jumpSearch = null;
    // A new date starts at the top; the main Jump button resumes a paused search.
    jump("date:" + selectedDate);
  }

  function manualSave() {
    if (!getActiveTabKey()) return;
    const id = topId();
    if (!id) return;
    clearTrackingTimers();
    persist(id);
    jumpSearch = null;
    jumping = false;
    autoSavePaused = false;
    updateJumpButton("↓ Jump");
    isReadingActive = true;
    flash("✓ Saved");
  }

  function flash(msg, color = "#8bd6b2") {
    if (!bar) return;
    const root = bar;
    const notice = root.querySelector("#x-pos-notice");
    notice.textContent = msg;
    notice.style.color = color;
    notice.hidden = false;
    updateControls();
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      if (bar !== root) return;
      notice.hidden = true;
      refreshLabel();
    }, 2000);
  }

  const icons = {
    bookmark: '<path d="M6 20V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v15l-6-4z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    play: '<path d="m8 5 11 7-11 7z"/>',
    jump: '<path d="M12 3v13m-5-5 5 5 5-5M5 18v3h14v-3"/>',
    save: '<path d="M6 20V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v15l-6-4zM9 9l2 2 4-4"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18"/>',
    back: '<path d="m9 5-6 6 6 6M3 11h11a6 6 0 0 1 6 6v2"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    grip: '<path d="M5 8h.01M12 8h.01M19 8h.01M5 16h.01M12 16h.01M19 16h.01" stroke-width="3"/>',
    left: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    right: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
    hide: '<path d="m3 3 18 18M10 5a10 10 0 0 1 11 7 15 15 0 0 1-4 5M6 6a15 15 0 0 0-3 6 10 10 0 0 0 11 7M10 10a3 3 0 0 0 4 4"/>',
  };

  function setIcon(button, name) {
    if (button.dataset.icon === name) return;
    button.dataset.icon = name;
    // Only authored SVG paths enter HTML; bookmark IDs and status use textContent.
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
  }

  function makeButton(label, glyph, fn, text = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    if (glyph) setIcon(button, glyph);
    if (text) {
      button.className = "x-pos-text";
      const span = document.createElement("span");
      span.textContent = text;
      button.append(span);
    }
    button.onclick = e => { e.stopPropagation(); fn(); };
    return button;
  }

  function savePlacement() {
    try { localStorage.setItem(UI_KEY, JSON.stringify(placement)); }
    catch { /* Keep the current placement in memory when storage is unavailable. */ }
  }

  function clamp(value, min, max) { return Math.min(Math.max(value, min), Math.max(min, max)); }

  function positionUI() {
    if (!bar?.isConnected) return;
    bar.dataset.side = placement.side;
    bar.style[placement.side] = "16px";
    bar.style[placement.side === "left" ? "right" : "left"] = "auto";
    // Reserve the bottom plugin area for both the rail and its expanded panel.
    bar.style.top = `${clamp(placement.y * innerHeight, 12, innerHeight - bar.offsetHeight - 96)}px`;
    const panel = bar.querySelector("#x-pos-panel");
    if (!panel || panel.hidden) return;
    panel.style.width = `${Math.min(288, innerWidth - 84)}px`;
    panel.style.maxHeight = `${Math.max(100, innerHeight - 116)}px`;
    panel.style.top = `${clamp(bar.offsetTop, 12, innerHeight - panel.offsetHeight - 96)}px`;
    panel.style[placement.side] = "70px";
    panel.style[placement.side === "left" ? "right" : "left"] = "auto";
  }

  function setPanel(open, focus = true, date = false) {
    if (!bar) return;
    panelOpen = open;
    bar.dataset.open = String(open);
    bar.querySelector("#x-pos-panel").hidden = !open;
    const toggle = bar.querySelector("#x-pos-toggle");
    toggle.setAttribute("aria-expanded", String(open));
    updateControls();
    if (focus) {
      const input = bar.querySelector("#x-pos-date");
      const target = open ? date && !input.disabled ? input : bar.querySelector("#x-pos-panel-close") : toggle;
      target.focus({ preventScroll: true });
    }
  }

  function setDismissed(value) {
    if (!bar) return;
    dismissed = value;
    bar.dataset.dismissed = String(value);
    setPanel(false, false);
    bar.querySelector(value ? "#x-pos-restore" : "#x-pos-toggle").focus({ preventScroll: true });
  }

  function build() {
    if (bar?.isConnected || !document.body) return;
    const root = document.createElement("div");
    bar = root;
    root.id = "x-pos-bar";
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "Reading position");
    root.dataset.dismissed = String(dismissed);
    const style = document.createElement("style");
    style.textContent = `
      #x-pos-bar, #x-pos-bar * { box-sizing: border-box; }
      #x-pos-bar { position: fixed; width: 44px; z-index: 9999; color: #eff3f5;
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color-scheme: dark; font-variant-numeric: tabular-nums; text-align: left; }
      #x-pos-bar [hidden] { display: none !important; }
      #x-pos-bar ::selection { background: #294b65; color: #fff; }
      #x-pos-bar button { appearance: none; display: inline-flex; align-items: center; justify-content: center;
        flex: none; gap: 6px; width: 34px; height: 34px; margin: 0; padding: 7px; border: 0; border-radius: 8px;
        background: transparent; color: #b8c5cf; font: inherit; font-weight: 550; cursor: pointer; }
      #x-pos-bar button:hover:not(:disabled) { background: #2a3843; color: #fff; }
      #x-pos-bar button:disabled { opacity: .45; cursor: not-allowed; }
      #x-pos-bar button:focus-visible, #x-pos-bar input:focus-visible { outline: 2px solid #80c8fa; outline-offset: 2px; }
      #x-pos-bar svg { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor;
        stroke-width: 1.65; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
      #x-pos-rail { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 5px;
        background: #17212a; border-radius: 12px; box-shadow: 0 7px 26px #0009;
        max-height: calc(100dvh - 116px); overflow-y: auto; scrollbar-width: none; }
      #x-pos-bar #x-pos-grip { height: 24px; touch-action: none; cursor: grab; color: #9bafbd; }
      #x-pos-bar #x-pos-grip:active { cursor: grabbing; }
      #x-pos-grip svg { width: 14px; height: 14px; }
      #x-pos-count { font-size: 10px; line-height: 14px; color: #b4c8d7; }
      #x-pos-bar #x-pos-jump, #x-pos-bar #x-pos-bookmark { background: #183246; color: #a4d9fc; }
      #x-pos-bar[data-mode=searching] #x-pos-jump { background: #45252c; color: #ffb5bc; }
      #x-pos-bar[data-mode=reading] #x-pos-toggle { color: #8bd6b2; }
      #x-pos-bar[data-mode=paused] #x-pos-toggle { color: #e0b979; }
      #x-pos-bar #x-pos-toggle[aria-expanded=true] { background: #203d52; }
      #x-pos-bar .x-pos-separator { width: 22px; height: 1px; background: #33404b; margin: 2px 0; }
      #x-pos-panel { position: fixed; padding: 16px; border-radius: 12px; background: #151a1f;
        box-shadow: 0 12px 48px #000a; overflow-y: auto; overscroll-behavior: contain;
        scrollbar-width: thin; scrollbar-color: #4a5966 #151a1f; }
      #x-pos-bar .x-pos-heading, #x-pos-bar .x-pos-saved, #x-pos-bar .x-pos-placement,
      #x-pos-bar .x-pos-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      #x-pos-bar h2 { margin: 0; font: inherit; font-size: 14px; font-weight: 600; }
      #x-pos-bar #x-pos-panel-close { width: 28px; height: 28px; margin-right: -5px; }
      #x-pos-lbl { display: block; margin: 10px 0 14px; color: #b4c8d7; font-size: 12px; overflow-wrap: anywhere; }
      #x-pos-bar .x-pos-saved { margin-bottom: 12px; font-size: 12px; color: #a1afba; }
      #x-pos-saved { color: #eff3f5; font-weight: 500; }
      #x-pos-bar .x-pos-buttons, #x-pos-bar .x-pos-date-row { display: flex; gap: 8px; }
      #x-pos-bar .x-pos-text { width: auto; padding: 0 10px; font-size: 12px; }
      #x-pos-bar .x-pos-buttons button { flex: 1; background: #26313a; color: #e5eef4; }
      #x-pos-bar #x-pos-return { margin-top: 8px; padding-left: 0; }
      #x-pos-bar .x-pos-date-section { margin-top: 14px; padding-top: 14px; border-top: 1px solid #303a43; }
      #x-pos-bar label { display: block; margin-bottom: 8px; font-size: 12px; color: #d0dce5; }
      #x-pos-date { flex: 1; width: 0; min-width: 0; height: 35px; border: 1px solid #4a5966; border-radius: 7px;
        padding: 0 8px; background: #0c1217; color: #edf4f8; font: inherit; caret-color: #a4d9fc; }
      #x-pos-bar #x-pos-go { background: #183246; color: #a4d9fc; height: 35px; }
      #x-pos-date-note { margin: 9px 0 0; font-size: 11px; line-height: 1.7; color: #a4b6c4; }
      #x-pos-bar .x-pos-placement { border-top: 1px solid #303a43; margin-top: 14px; padding-top: 10px; }
      #x-pos-bar .x-pos-placement > span { margin-right: auto; font-size: 12px; color: #a4b6c4; }
      #x-pos-bar .x-pos-placement button { width: 28px; height: 28px; }
      #x-pos-bar .x-pos-placement button[aria-pressed=true] { background: #293c49; color: #afe0ff; }
      #x-pos-bar .x-pos-footer { margin-top: 8px; }
      #x-pos-bar .x-pos-footer button { height: 28px; padding: 0; font-size: 11px; }
      #x-pos-bar .x-pos-footer svg { width: 14px; height: 14px; }
      #x-pos-notice { position: absolute; top: 0; width: min(240px, calc(100vw - 90px)); padding: 10px 12px;
        background: #17212a; box-shadow: 0 7px 26px #0009; border-radius: 8px; font-size: 12px; }
      #x-pos-bar[data-side=right] #x-pos-notice { right: 54px; }
      #x-pos-bar[data-side=left] #x-pos-notice { left: 54px; }
      #x-pos-bar #x-pos-restore { display: none; width: 44px; height: 44px; background: #17212a;
        border-radius: 12px; box-shadow: 0 7px 26px #0009; }
      #x-pos-bar[data-dismissed=true] #x-pos-rail, #x-pos-bar[data-dismissed=true] #x-pos-notice { display: none; }
      #x-pos-bar[data-open=true] #x-pos-notice { width: 1px; height: 1px; padding: 0;
        overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
      #x-pos-bar[data-dismissed=true] #x-pos-restore { display: inline-flex; }
      @media (max-width: 360px) { #x-pos-date { font-size: 11px; } }
    `;
    const rail = document.createElement("div");
    rail.id = "x-pos-rail";
    const grip = makeButton("Drag vertically · Arrow keys move/dock · Home resets height", "grip", () => {});
    grip.id = "x-pos-grip";
    let drag = null;
    function move(top) {
      placement.y = clamp(top, 12, innerHeight - root.offsetHeight - 96) / innerHeight;
      positionUI();
    }
    grip.onpointerdown = e => {
      if (e.button !== 0 || drag) return;
      setPanel(false, false);
      drag = { id: e.pointerId, y: e.clientY, top: root.offsetTop };
      grip.setPointerCapture(e.pointerId);
    };
    grip.onpointermove = e => {
      if (drag?.id === e.pointerId && bar === root) move(drag.top + e.clientY - drag.y);
    };
    grip.onpointerup = grip.onpointercancel = grip.onlostpointercapture = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const id = drag.id;
      drag = null;
      if (grip.hasPointerCapture(id)) grip.releasePointerCapture(id);
      savePlacement();
    };
    grip.onkeydown = e => {
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home"].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") dock(e.key === "ArrowLeft" ? "left" : "right");
      else {
        move(e.key === "Home" ? innerHeight * 0.3 : root.offsetTop + (e.key === "ArrowUp" ? -12 : 12));
        savePlacement();
      }
    };
    const toggle = makeButton("Reading position controls", "bookmark", () => setPanel(!panelOpen));
    toggle.id = "x-pos-toggle";
    toggle.setAttribute("aria-controls", "x-pos-panel");
    const counter = document.createElement("span");
    counter.id = "x-pos-count";
    const main = makeButton("Jump to saved bookmark", "jump", () => jumping ? stopJump() : jump());
    main.id = "x-pos-jump";
    const separator = document.createElement("div");
    separator.className = "x-pos-separator";
    const calendar = makeButton("Jump to date", "calendar", () => setPanel(true, true, true));
    const save = makeButton("Save current position", "save", manualSave);
    save.dataset.save = "";
    rail.append(grip, toggle, counter, main, separator, calendar, save);

    const panel = document.createElement("section");
    panel.id = "x-pos-panel";
    panel.setAttribute("aria-label", "Reading position controls");
    // This template contains no timeline or user-supplied data.
    panel.innerHTML = `<div class="x-pos-heading"><h2>Reading position</h2></div>
      <span id="x-pos-lbl"></span>
      <div class="x-pos-saved"><span>Saved bookmark</span><strong id="x-pos-saved"></strong></div>
      <div class="x-pos-buttons"></div>
      <div class="x-pos-date-section"><label for="x-pos-date">Jump to date · Local time</label>
        <div class="x-pos-date-row"></div><p id="x-pos-date-note"></p></div>
      <div class="x-pos-placement"><span>Dock</span></div><div class="x-pos-footer"></div>`;
    const close = makeButton("Close controls", "close", () => setPanel(false));
    close.id = "x-pos-panel-close";
    panel.querySelector(".x-pos-heading").append(close);
    const bookmark = makeButton("Jump to saved bookmark", "jump", () => jump(saved()), "Jump");
    bookmark.id = "x-pos-bookmark";
    const panelSave = makeButton("Save current position", "save", manualSave, "Save");
    panelSave.dataset.save = "";
    const buttons = panel.querySelector(".x-pos-buttons");
    buttons.append(bookmark, panelSave);
    const back = makeButton("Back to previous position", "back", returnToLast, "Back to previous position");
    back.id = "x-pos-return";
    back.hidden = true;
    buttons.after(back);
    const dateInput = document.createElement("input");
    dateInput.id = "x-pos-date";
    dateInput.type = "date";
    dateInput.required = true;
    dateInput.min = "2006-03-21";
    dateInput.value = selectedDate || localDate();
    dateInput.setAttribute("aria-describedby", "x-pos-date-note");
    dateInput.oninput = () => { selectedDate = dateInput.value; dateInput.setCustomValidity(""); };
    dateInput.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); jumpToDate(); } };
    const go = makeButton("Go to date", null, jumpToDate, "Go");
    go.id = "x-pos-go";
    panel.querySelector(".x-pos-date-row").append(dateInput, go);
    function dock(side) {
      placement.side = side;
      for (const button of panel.querySelectorAll("[data-dock]")) {
        button.setAttribute("aria-pressed", String(button.dataset.dock === side));
      }
      positionUI();
      savePlacement();
    }
    for (const side of ["left", "right"]) {
      const button = makeButton(`Dock ${side}`, side, () => dock(side));
      button.dataset.dock = side;
      button.setAttribute("aria-pressed", String(placement.side === side));
      panel.querySelector(".x-pos-placement").append(button);
    }
    panel.querySelector(".x-pos-footer").append(
      makeButton("Hide controls; automatic recording is unchanged", "hide", () => setDismissed(true), "Hide"),
      makeButton("Reset position", null, () => { placement.y = 0.3; dock("right"); }, "Reset position"),
    );
    const restore = makeButton("Show reading position controls", "bookmark", () => setDismissed(false));
    restore.id = "x-pos-restore";
    const notice = document.createElement("div");
    notice.id = "x-pos-notice";
    notice.setAttribute("role", "status");
    notice.hidden = true;
    root.append(style, rail, panel, restore, notice);
    document.body.append(root);
    setPanel(panelOpen, false);
    updateReturnButton(pendingId !== null);
  }

  function check() {
    const k = getActiveTabKey();
    if (!k) {
      if (bar) { bar.remove(); bar = null; }
      return;
    }

    build();
    if (!dismissed) refreshLabel();
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", positionUI);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && panelOpen) {
      e.preventDefault();
      e.stopPropagation();
      setPanel(false);
    }
  });
  setInterval(check, 1000);
  document.addEventListener("click", (e) => {
    if (panelOpen && bar && !e.composedPath().includes(bar)) setPanel(false, false);
    const tab = e.target.closest('[role="tab"]');
    if (!tab) return;
    if (tab.getAttribute("aria-selected") !== "true") {
      // A deliberate tab switch must not reuse the old key while the new tab loads.
      session = { path: null, key: null, tabText: null };
      clearTrackingTimers();
    }
    setTimeout(check, 100);
  });
  setTimeout(check, 500);
})();
