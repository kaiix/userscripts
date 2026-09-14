// ==UserScript==
// @name         X/Twitter Timeline Position Saver
// @namespace    http://tampermonkey.net/
// @version      4.10
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

  let jumping = false;
  let jumpStatus = "↓ Jump";
  let jumpSearch = null;
  let selectedDate = "";
  let autoSavePaused = false;
  let dismissed = false;
  let bar = null;
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
    const lbl = document.getElementById("x-pos-lbl");
    if (!lbl) return;
    if (jumping) {
      scanTimeline();
      lbl.textContent = jumpStatus;
      return;
    }
    if (autoSavePaused) {
      lbl.textContent = "Auto-save paused";
      return;
    }
    scanTimeline();
    const tid = topId();
    if (!tid) return;
    const idx = idToIndex.get(tid);
    lbl.textContent = idx ? `#${idx}` : "";
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
    if (show && lastCommittedId) {
      btn.style.display = "inline-flex";
    } else {
      btn.style.display = "none";
    }
  }

  function findArticle(targetId) {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    return Array.from(articles).find(a => a.offsetHeight !== 0 && idOf(a) === targetId);
  }

  function updateJumpButton(text) {
    jumpStatus = text;
    const btn = document.getElementById("x-pos-jump");
    if (btn) {
      btn.textContent = jumping ? "Stop" : text;
      btn.style.background = jumping ? "#b42332" : "rgba(29,155,240,0.9)";
    }
    const lbl = document.getElementById("x-pos-lbl");
    if (lbl && jumping) lbl.textContent = text;
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

  function flash(msg, color) {
    const lbl = document.getElementById("x-pos-lbl");
    if (!lbl) return;
    const old = lbl.textContent;
    lbl.textContent = msg;
    lbl.style.color = color || "#17bf63";
    setTimeout(() => {
      lbl.textContent = old;
      lbl.style.color = "";
      refreshLabel();
    }, 2000);
  }

  function build() {
    if (bar?.isConnected || !document.body) return;
    bar = document.createElement("div");
    bar.id = "x-pos-bar";
    Object.assign(bar.style, {
      position: "fixed", bottom: "20px", right: "20px", display: "flex", alignItems: "center",
      flexWrap: "wrap", maxWidth: "calc(100vw - 40px)", boxSizing: "border-box",
      gap: "8px", background: "rgba(0,0,0,0.85)", color: "#fff", padding: "8px 12px",
      borderRadius: "14px", fontFamily: 'sans-serif', fontSize: "13px", zIndex: "9999",
      boxShadow: "0 4px 12px rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)"
    });
    const lbl = document.createElement("span"); lbl.id = "x-pos-lbl";
    const jumpBtn = makePill(jumpStatus, "rgba(29,155,240,0.9)", () => {
      if (jumping) stopJump();
      else jump();
    });
    jumpBtn.id = "x-pos-jump";
    const dateInput = document.createElement("input");
    dateInput.id = "x-pos-date";
    dateInput.type = "date";
    dateInput.required = true;
    dateInput.min = "2006-03-21";
    dateInput.max = localDate();
    dateInput.value = selectedDate || localDate();
    dateInput.setAttribute("aria-label", "Jump to date in local time");
    dateInput.title = "Local time; reposts use their repost date. Reload X after installing to capture timeline dates.";
    Object.assign(dateInput.style, { colorScheme: "dark", background: "#242424", color: "#fff",
      border: "1px solid #666", borderRadius: "6px", padding: "5px", font: "inherit", minWidth: "0" });
    dateInput.oninput = () => { selectedDate = dateInput.value; dateInput.setCustomValidity(""); };
    const dateBtn = makePill("Go to date", "rgba(29,155,240,0.9)", jumpToDate);
    dateInput.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); jumpToDate(); } };
    const saveBtn = makePill("📌 Save", "rgba(255,255,255,0.13)", manualSave);
    const returnBtn = makePill("↩ Back", "#e0245e", returnToLast);
    returnBtn.id = "x-pos-return";
    returnBtn.style.display = "none";
    const closeBtn = document.createElement("span"); 
    closeBtn.textContent = "✕";
    closeBtn.style.cursor = "pointer";
    closeBtn.onclick = () => { dismissed = true; bar.remove(); bar = null; };
    
    bar.append(lbl, jumpBtn, dateInput, dateBtn, saveBtn, returnBtn, closeBtn);
    document.body.appendChild(bar);
    updateJumpButton(jumpStatus);
    updateReturnButton(pendingId !== null);
  }

  function makePill(text, bg, fn) {
    const b = document.createElement("button");
    b.textContent = text;
    Object.assign(b.style, { background: bg, color: "#fff", border: "none", padding: "5px 12px", borderRadius: "9999px", cursor: "pointer", fontWeight: "bold", display: "inline-flex", alignItems: "center" });
    b.onclick = (e) => { e.stopPropagation(); fn(); };
    return b;
  }

  function check() {
    const k = getActiveTabKey();
    if (!k) {
      if (bar) { bar.remove(); bar = null; }
      return;
    }

    if (!dismissed) {
      build();
      refreshLabel();
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  setInterval(check, 1000);
  document.addEventListener("click", (e) => {
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
