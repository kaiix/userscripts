// ==UserScript==
// @name        GitHub PR: Jump to code in current diff
// @namespace   userscripts.org.kaiix
// @version     0.1
// @description Adds a button next to each review comment's "Jump to the comment in the diff" that jumps to the corresponding code location in the current changeset's diff (prefers the left/base side).
// @author      kaiix
// @match       https://github.com/*/*/pull/*/files*
// @match       https://github.com/*/*/pull/*/changes*
// @grant       none
// @run-at      document-idle
// ==/UserScript==

(function () {
  "use strict";

  const INJECTED_FLAG = "jtcInjected";
  const BTN_TOOLTIP = "Jump to code in the current diff";

  // ---------- utilities ----------

  function log(...args) {
    // console.log("[jtc]", ...args);
  }

  // Shared toast styling helper.
  function styleToast(t) {
    Object.assign(t.style, {
      background: "var(--bgColor-emphasis, #1f2328)",
      color: "var(--fgColor-onEmphasis, #ffffff)",
      padding: "6px 10px",
      borderRadius: "6px",
      fontSize: "12px",
      lineHeight: "1.4",
      boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
      maxWidth: "280px",
      pointerEvents: "auto",
    });
  }

  // Show a toast anchored just below a specific button when provided; falls
  // back to the bottom-right corner otherwise. Anchoring is important because
  // the comments panel is tall — a bottom-of-page toast is invisible when the
  // user clicks a comment far above the fold.
  function showToast(msg, anchor) {
    const t = document.createElement("div");
    t.textContent = msg;
    styleToast(t);
    if (anchor && anchor.getBoundingClientRect) {
      const r = anchor.getBoundingClientRect();
      Object.assign(t.style, {
        position: "fixed",
        top: r.bottom + 6 + "px",
        // Right-align toast's right edge to the button's right edge so the
        // toast extends leftwards into the panel rather than off-screen.
        right: Math.max(8, window.innerWidth - r.right) + "px",
        zIndex: "2147483647",
      });
      document.body.appendChild(t);
    } else {
      let host = document.getElementById("jtc-toast-host");
      if (!host) {
        host = document.createElement("div");
        host.id = "jtc-toast-host";
        Object.assign(host.style, {
          position: "fixed",
          right: "16px",
          bottom: "16px",
          zIndex: "2147483647",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          pointerEvents: "none",
        });
        document.body.appendChild(host);
      }
      host.appendChild(t);
    }
    setTimeout(() => t.remove(), 3000);
  }

  function highlightRow(tr) {
    if (!tr) return;
    const prev = tr.style.outline;
    const prevOffset = tr.style.outlineOffset;
    const prevTrans = tr.style.transition;
    tr.style.transition = "outline-color 0.3s ease-out";
    tr.style.outline = "2px solid var(--fgColor-accent, #0969da)";
    tr.style.outlineOffset = "-2px";
    setTimeout(() => {
      tr.style.outline = prev || "";
      tr.style.outlineOffset = prevOffset || "";
      tr.style.transition = prevTrans || "";
    }, 2000);
  }

  // ---------- comment panel parsing ----------

  // The native "Jump to the comment in the diff" button:
  //   <a data-component="IconButton" href="#r<id>"> <svg class="octicon octicon-file-symlink-file"> </a>
  function findNativeJumpButtons(root = document) {
    return Array.from(
      root.querySelectorAll(
        'a[data-component="IconButton"][href^="#r"] svg.octicon-file-symlink-file'
      )
    ).map((svg) => svg.closest('a[data-component="IconButton"]'));
  }

  // Given the native jump button, find the comment card header (the row that also
  // contains the file-path <h2>). We walk up until we find an ancestor that
  // contains BOTH the button and an h2 with an anchor link starting with "#r".
  function findCardHeader(jumpBtn) {
    let node = jumpBtn.parentElement;
    while (node && node !== document.body) {
      const h2 = node.querySelector(":scope > h2, :scope h2");
      if (h2 && h2.querySelector('a[href^="#r"]')) {
        // prefer the tightest wrapper that also has the jump button as a direct/near child
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  // The preview table inside the comment card identifies the anchored line.
  // Walk up from the header looking for a table whose thead has a TH titled
  // "Original file line number" — this tolerates GitHub wrapping the header in
  // extra containers without us hardcoding any hashed class names.
  function findPreviewTable(cardHeader) {
    for (
      let node = cardHeader;
      node && node !== document.body;
      node = node.parentElement
    ) {
      const tables = node.querySelectorAll("table");
      for (const tbl of tables) {
        const ths = tbl.querySelectorAll("thead th");
        for (const th of ths) {
          if ((th.textContent || "").trim() === "Original file line number") {
            return tbl;
          }
        }
      }
      // Heuristic stop: if we've walked up to an element that already contains
      // multiple native jump buttons, we've left the current card.
      if (
        node !== cardHeader &&
        node.querySelectorAll(
          'a[data-component="IconButton"][href^="#r"] svg.octicon-file-symlink-file'
        ).length > 1
      ) {
        return null;
      }
    }
    return null;
  }

  function readCommentAnchor(cardHeader) {
    const h2 = cardHeader.querySelector("h2");
    if (!h2) return null;
    const a = h2.querySelector('a[href^="#r"]');
    if (!a) return null;
    // The h2 also contains a sibling span with text like "Line 69" — this is
    // the actual right-side (or sole) file line number where the comment is
    // anchored. The preview table's "Diff line number" column, in contrast, is
    // the position within the patch text (counts hunk headers + context), so
    // it does NOT match data-line-number on the diff cells. Outdated comments
    // omit this span entirely.
    let panelLine = "";
    for (const span of h2.querySelectorAll("span")) {
      const t = (span.textContent || "").trim();
      const m = /^Line\s+(\d+)\b/.exec(t);
      if (m) {
        panelLine = m[1];
        break;
      }
    }
    return {
      filePath: (a.textContent || "").trim(),
      commentHref: a.getAttribute("href") || "",
      panelLine,
    };
  }

  function readPreviewRow(table) {
    if (!table) return null;
    const tr = table.querySelector("tbody tr");
    if (!tr) return null;
    const tds = tr.querySelectorAll("td");
    if (tds.length < 3) return null;
    const origLine = (tds[0].textContent || "").trim();
    const diffLine = (tds[1].textContent || "").trim();
    const changeText = tds[2].textContent || "";
    // first non-space char
    const firstChar = changeText.replace(/^[\s\u00A0]+/, "")[0] || "";
    return { origLine, diffLine, marker: firstChar };
  }

  // ---------- main diff parsing ----------

  // Each file's diff is wrapped as:
  //   <div role="region" id="diff-<sha>" aria-labelledby="heading-..."> ...
  //     <h3 id="heading-..."> <a href="#diff-<sha>"><code>path/to/file</code></a> </h3>
  //     <table data-diff-anchor="diff-<sha>"> ... </table>
  //   </div>
  function buildPathToRegion() {
    const regions = document.querySelectorAll(
      'div[role="region"][id^="diff-"][aria-labelledby]'
    );
    const map = new Map();
    for (const region of regions) {
      const h3 = region.querySelector("h3");
      if (!h3) continue;
      const path = (h3.textContent || "").trim();
      if (!path) continue;
      map.set(path, region);
    }
    return map;
  }

  function findExpandButton(region) {
    // Header chevron when the file body is collapsed (tooltip = "Expand file").
    const buttons = region.querySelectorAll(
      'button[data-component="IconButton"][aria-labelledby]'
    );
    for (const btn of buttons) {
      const tip = document.getElementById(btn.getAttribute("aria-labelledby"));
      if (tip && (tip.textContent || "").trim() === "Expand file") return btn;
    }
    return null;
  }

  function findLoadDiffButton(region) {
    // Lazy "Load Diff" button shown for large/unloaded files (no IconButton wrapper).
    for (const btn of region.querySelectorAll("button")) {
      const txt = (btn.textContent || "").trim();
      if (txt === "Load Diff" || txt === "Load diff") return btn;
    }
    return null;
  }

  function waitForFrames(n = 2) {
    return new Promise((resolve) => {
      let i = 0;
      const tick = () => {
        if (++i >= n) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  async function ensureDiffTable(region) {
    const hasRows = (t) =>
      t && t.querySelector("td[data-diff-side][data-line-number]");
    let table = region.querySelector("table[data-diff-anchor]");
    if (hasRows(table)) return table;
    // Nudge the region into view so content-visibility / lazy hydration kicks in.
    try {
      region.scrollIntoView({ block: "start", behavior: "auto" });
    } catch (_) {}
    // Step 1: if the file is collapsed at the header, expand it.
    const expand = findExpandButton(region);
    if (expand) expand.click();
    const deadline = performance.now() + 5000;
    let loadClicked = false;
    while (performance.now() < deadline) {
      table = region.querySelector("table[data-diff-anchor]");
      if (hasRows(table)) return table;
      // Step 2: after expanding, large files may still need an explicit Load Diff click.
      if (!loadClicked) {
        const load = findLoadDiffButton(region);
        if (load) {
          load.click();
          loadClicked = true;
        }
      }
      await waitForFrames(2);
    }
    // Deadline expired. If the table exists but has no rows yet, treat this as
    // a loading failure (return null) so the handler can tell the user instead
    // of claiming the line is absent from the diff.
    table = region.querySelector("table[data-diff-anchor]");
    return hasRows(table) ? table : null;
  }

  function findLineCell(table, side, lineNo) {
    return table.querySelector(
      `td[data-diff-side="${side}"][data-line-number="${lineNo}"]`
    );
  }

  function findNearestLineCell(table, preferredSide, lineNo) {
    const n = Number(lineNo);
    if (!Number.isFinite(n)) return null;
    // Pick the globally nearest row; use preferred side only as a tie-breaker.
    // Previously we searched the preferred side first and returned as soon as
    // it had any match, which could land far from the target when the other
    // side had a much closer line.
    let best = null;
    let bestDist = Infinity;
    let bestPreferred = false;
    const cells = table.querySelectorAll(
      "td[data-diff-side][data-line-number]"
    );
    for (const c of cells) {
      const v = Number(c.getAttribute("data-line-number"));
      if (!Number.isFinite(v)) continue;
      const d = Math.abs(v - n);
      const isPreferred = c.getAttribute("data-diff-side") === preferredSide;
      if (d < bestDist || (d === bestDist && isPreferred && !bestPreferred)) {
        bestDist = d;
        best = c;
        bestPreferred = isPreferred;
      }
    }
    return best;
  }

  // ---------- click handler ----------

  async function handleJump(cardHeader, toastAnchor) {
    const anchor = readCommentAnchor(cardHeader);
    if (!anchor) {
      showToast("Could not read comment metadata", toastAnchor);
      return;
    }
    const row = readPreviewRow(findPreviewTable(cardHeader));
    if (!row) {
      showToast("Could not read comment line info", toastAnchor);
      return;
    }
    log("jump", anchor, row);

    const pathMap = buildPathToRegion();
    const region = pathMap.get(anchor.filePath);
    if (!region) {
      showToast(`File not in current diff: ${anchor.filePath}`, toastAnchor);
      return;
    }

    // Helper: scroll to the file region itself as a graceful fallback when we
    // can't resolve a specific line.
    const scrollToRegion = () => {
      region.scrollIntoView({ block: "start", behavior: "smooth" });
    };

    const table = await ensureDiffTable(region);
    if (!table) {
      scrollToRegion();
      showToast("File is not expanded / no diff rows available", toastAnchor);
      return;
    }

    let side, lineNo;
    // Prefer the panel header's "Line N" label — this is the real file line
    // number (left for - lines, right for + or context lines). The preview
    // table's diffLine counts patch text positions and is wrong for our use.
    if (anchor.panelLine) {
      lineNo = anchor.panelLine;
      // Decide which column to look up: marker '-' means deletion (left side),
      // anything else (+, context) lives on the right side.
      side = row.marker === "-" ? "left" : "right";
    } else if (row.origLine) {
      side = "left";
      lineNo = row.origLine;
    } else {
      // Outdated comments with no usable line info — at least bring the user
      // to the file so they have context for the comment.
      scrollToRegion();
      showToast(
        "Outdated comment — jumped to file (no current line)",
        toastAnchor
      );
      return;
    }

    let cell = findLineCell(table, side, lineNo);
    let fallbackUsed = false;
    if (!cell) {
      cell = findNearestLineCell(table, side, lineNo);
      fallbackUsed = !!cell;
    }
    if (!cell) {
      scrollToRegion();
      showToast("No locatable line in this file's current diff", toastAnchor);
      return;
    }

    const tr = cell.closest("tr") || cell;
    // Account for the sticky PR toolbar + sticky file header at the top of the
    // viewport (~110px). Without this offset, the row lands directly under the
    // sticky stack and any inline comment popover above/below it is clipped.
    tr.style.scrollMarginTop = "120px";
    tr.scrollIntoView({ block: "start", behavior: "smooth" });
    highlightRow(tr);
    if (fallbackUsed) {
      const actual = cell.getAttribute("data-line-number");
      showToast(
        `Line ${lineNo} not in current diff — jumped to nearest line ${actual}`,
        toastAnchor
      );
    }
  }

  // ---------- button injection ----------

  function buildButton(nativeBtn) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-component", "IconButton");
    // Reuse whatever class the native button uses so we blend in visually.
    // These classes are GitHub's (possibly hashed) — we copy them rather than
    // hardcode them, so we remain stable across renames.
    if (nativeBtn.className) btn.className = nativeBtn.className;
    btn.setAttribute("aria-label", BTN_TOOLTIP);
    btn.title = BTN_TOOLTIP;
    btn.style.marginLeft = "2px";

    // Octicon arrow-right (16x16) — stable octicon class names.
    btn.innerHTML =
      '<svg aria-hidden="true" focusable="false" class="octicon octicon-arrow-right" ' +
      'viewBox="0 0 16 16" width="16" height="16" fill="currentColor" ' +
      'display="inline-block" overflow="visible" style="vertical-align:text-bottom;">' +
      '<path d="M8.22 2.97a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L11.19 8.75H2.75a.75.75 0 0 1 0-1.5h8.44L8.22 4.03a.75.75 0 0 1 0-1.06Z"></path>' +
      "</svg>";

    return btn;
  }

  function injectForNativeBtn(nativeBtn) {
    const header = findCardHeader(nativeBtn);
    if (!header) return;
    if (header.dataset[INJECTED_FLAG] === "1") return;

    const btn = buildButton(nativeBtn);
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      handleJump(header, btn).catch((e) => {
        console.error("[jtc]", e);
        showToast("Jump failed (see console)", btn);
      });
    });

    // Place immediately after the native jump button.
    if (nativeBtn.parentElement) {
      nativeBtn.parentElement.insertBefore(btn, nativeBtn.nextSibling);
    }
    header.dataset[INJECTED_FLAG] = "1";
  }

  function scanAndInject(root) {
    for (const nativeBtn of findNativeJumpButtons(root)) {
      injectForNativeBtn(nativeBtn);
    }
  }

  // ---------- observer ----------

  function isTargetPage() {
    return /^\/[^/]+\/[^/]+\/pull\/\d+\/(files|changes)(\/|$)/.test(
      location.pathname
    );
  }

  let scheduled = false;
  let pendingRoots = new Set();
  function scheduleScan(root) {
    if (root) pendingRoots.add(root);
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (!isTargetPage()) {
        pendingRoots.clear();
        return;
      }
      const roots = pendingRoots.size ? Array.from(pendingRoots) : [document];
      pendingRoots.clear();
      for (const r of roots) {
        try {
          scanAndInject(r);
        } catch (e) {
          console.error("[jtc] scan failed", e);
        }
      }
    });
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1) scheduleScan(n);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  function onRouteChange() {
    if (isTargetPage()) scheduleScan(document);
  }
  document.addEventListener("turbo:load", onRouteChange);
  document.addEventListener("turbo:render", onRouteChange);
  window.addEventListener("popstate", onRouteChange);
  onRouteChange();
})();
