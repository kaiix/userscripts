// ==UserScript==
// @name         Telegram Web Tag Filter (Configurable)
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  Automatically hide channel messages containing specific tags. Configurable via Violentmonkey menu.
// @author       Gemini
// @match        https://web.telegram.org/k/*
// @match        https://web.telegram.org/a/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/kaiix/userscripts/main/tg-web-filter.user.js
// @downloadURL  https://raw.githubusercontent.com/kaiix/userscripts/main/tg-web-filter.user.js
// @supportURL   https://github.com/kaiix/userscripts/issues
// ==/UserScript==

(function () {
  "use strict";

  // ==========================================
  // INITIALIZATION
  // ==========================================
  const DEFAULT_TAGS = "#广告 #推广 #短剧"; // Defaulting to spaces now for a cleaner look

  let rawTags = GM_getValue("blockedTags", DEFAULT_TAGS);
  let BLOCKED_TAGS = parseTags(rawTags);

  // Helper to turn a string into a clean array, splitting by commas OR spaces
  function parseTags(str) {
    // The regex /[,\s]+/ splits the string at any comma or whitespace (space, tab, newline)
    return str
      .split(/[,\s]+/)
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }

  /**
   * Scans the DOM and applies the hide/show logic based on current tags.
   */
  function applyFilter() {
    const messageElements = document.querySelectorAll(
      ".bubble, .message, .Message",
    );

    messageElements.forEach((msgNode) => {
      const textContent = msgNode.innerText || msgNode.textContent || "";

      // Check if any of the blocked tags exist in the message text
      const hasBlockedTag =
        BLOCKED_TAGS.length > 0 &&
        BLOCKED_TAGS.some((tag) => textContent.includes(tag));

      if (hasBlockedTag) {
        // Hide the message
        msgNode.style.display = "none";
      } else {
        // Restore visibility if a tag was removed from the blocklist
        if (msgNode.style.display === "none") {
          msgNode.style.display = "";
        }
      }
    });
  }

  // ==========================================
  // UI CONFIGURATION (VIOLENTMONKEY MENU)
  // ==========================================
  GM_registerMenuCommand("⚙️ Configure Blocked Tags", () => {
    const currentTagsStr = GM_getValue("blockedTags", DEFAULT_TAGS);

    // Prompt the user for input, updated instructions
    const newTagsStr = prompt(
      "Enter tags to block (separated by spaces or commas):\nExample: #短剧 #广告，#推广",
      currentTagsStr,
    );

    // If the user didn't click Cancel
    if (newTagsStr !== null) {
      GM_setValue("blockedTags", newTagsStr); // Save to local storage
      BLOCKED_TAGS = parseTags(newTagsStr); // Update active array

      // Re-run the filter immediately so changes take effect without reloading
      applyFilter();
    }
  });

  // ==========================================
  // EXECUTION
  // ==========================================

  // 1. Initial run for messages already loaded
  setTimeout(applyFilter, 2000);

  // 2. Observer for dynamically loaded messages as you scroll
  const observer = new MutationObserver((mutationsList) => {
    for (const mutation of mutationsList) {
      if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
        applyFilter();
        break; // Prevent multiple runs in a single DOM batch update
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
})();
