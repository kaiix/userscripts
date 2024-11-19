// ==UserScript==
// @name        Twitter Start Tab
// @version     1.1.0
// @description set starting tab for twitter
// @author      kaiix
// @namespace   https://github.com/kaiix
// @license     MIT
// @match       https://twitter.com/*
// @match       https://x.com/*
// @icon        https://www.google.com/s2/favicons?sz=64&domain=twitter.com
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_registerMenuCommand
// @grant       GM_unregisterMenuCommand
// @updateURL   https://raw.githubusercontent.com/kaiix/userscripts/main/twitter-start-tab.user.js
// @downloadURL https://raw.githubusercontent.com/kaiix/userscripts/main/twitter-start-tab.user.js
// @supportURL  https://github.com/kaiix/userscripts/issues
// ==/UserScript==

(function () {
  "use strict";

  function useOption(key, title, defaultValue) {
    if (typeof GM_getValue === "undefined") {
      return {
        value: defaultValue,
      };
    }

    let value = GM_getValue(key, defaultValue);
    const ref = {
      get value() {
        return value;
      },
      set value(v) {
        value = v;
        GM_setValue(key, v);
        location.reload();
      },
    };

    GM_registerMenuCommand(`${title}: ${value}`, () => {
      ref.value = prompt("Start tab name:");
    });

    return ref;
  }

  const startTab = useOption("twitter_start_tab", "current tab", "Following");

  async function findTab(tabName) {
    const maxAttempts = 10;

    for (let attempts = 0; attempts < maxAttempts; attempts++) {
      const tabs = document.querySelectorAll('a[role="tab"]');
      const tab = Array.from(tabs).find(
        (el) => el.innerText.trim().toLowerCase() === tabName.toLowerCase()
      );

      if (tab) {
        return tab;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    console.warn(`[Twitter Start Tab] Failed to find tab: ${tabName}`);
    return null;
  }

  const observer = new MutationObserver(async (mutations, obs) => {
    if (document.querySelector('a[role="tab"]')) {
      obs.disconnect();
      const tab = await findTab(startTab.value);
      if (tab && tab.getAttribute("aria-selected") !== "true") {
        tab.click();
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
})();
