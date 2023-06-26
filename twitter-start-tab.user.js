// ==UserScript==
// @name        Twitter Start Tab
// @version     1.0.0
// @description set starting tab for twitter
// @author      kaiix
// @namespace   https://github.com/kaiix
// @license     MIT
// @match       https://twitter.com/*
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

  function findTab(tabName) {
    const tabs = document.querySelectorAll('a[role="tab"]');
    const result = Array.from(tabs).filter(
      (el) => el.innerText.toLowerCase() === tabName.toLowerCase()
    );
    return result.length > 0 ? result[0] : null;
  }

  window.addEventListener("load", () => {
    setTimeout(() => {
      const tab = findTab(startTab.value);
      if (tab) tab.click();
    }, 800);
  });
})();
