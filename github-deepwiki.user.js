// ==UserScript==
// @name        GitHub to DeepWiki
// @namespace   userscripts.org.kaiix
// @version     0.1
// @description Adds a button to GitHub repository pages to open the corresponding DeepWiki page.
// @author      kaiix
// @match       https://github.com/*/*
// @grant       GM_addStyle
// @icon        https://deepwiki.com/favicon.ico
// @run-at      document-idle
// ==/UserScript==

(function () {
  "use strict";

  const BUTTON_MARKER_CLASS = "deepwiki-btn-marker";

  // These are top-level paths on github.com that are definitely not user/org repos
  // or where the button doesn't make sense.
  const NON_REPO_PATH_PREFIXES = [
    "pulls",
    "issues",
    "marketplace",
    "explore",
    "notifications",
    "settings",
    "topics",
    "collections",
    "sponsors",
    "organizations",
    "search",
    "codespaces",
    "login",
    "join",
    "features",
    "about",
    "pricing",
    "contact",
    "site",
    "readme",
    "assets",
    "blog",
    "careers",
    "customer-stories",
    "security",
    "press",
    "shop",
    "trending",
    "events",
    "gists",
    "watching",
    "stars",
    "dashboard",
    "codes",
    "account",
    "apps",
    "billing",
    "developer",
    "installation",
    "marketplace_listing",
    "stories",
    "release",
    "releases",
    "pulse",
  ];

  function isValidRepoPage() {
    const pathname = window.location.pathname;
    const pathParts = pathname.split("/").filter(Boolean);

    if (pathParts.length < 2) {
      // Must be at least /owner/repo
      // console.log('[DeepWiki] Not a repo page (path too short):', pathname);
      return false;
    }

    if (NON_REPO_PATH_PREFIXES.includes(pathParts[0])) {
      // console.log('[DeepWiki] Not a repo page (forbidden first segment):', pathParts[0]);
      return false;
    }

    // Handle cases like /orgs/ORGNAME which is an org page, not a repo.
    // The @match */* allows /orgs/ORGNAME. pathParts[0] will be 'orgs'.
    // NON_REPO_PATH_PREFIXES includes 'organizations', which can stand in for 'orgs'.
    // If 'orgs' is explicitly used as a path prefix, check it.
    if (pathParts[0] === "orgs" && pathParts.length < 3) {
      // This means URL is like github.com/orgs/some-org (not a repo page)
      // console.log('[DeepWiki] Not a repo page (/orgs/ORGNAME specific case):', pathname);
      return false;
    }

    return true;
  }

  function findButtonContainer() {
    // 1. Try the selector from the user's screenshot (classic GitHub UI)
    let container = document.querySelector("ul.pagehead-actions");
    if (container) return container;

    // 2. Try to find the modern equivalent: a div containing Star/Fork buttons.
    const starButton = document.querySelector(
      'form.js-site-form button[data-hydro-click*="STAR"],' + // Common star button
        "form.starred button," + // Another star button form
        'button[aria-label*="Star this repository"],' + // Star button by aria-label
        'a[data-ga-click*="star"],' + // Star link
        'div[aria-label="Repository actions"] button[aria-label*="Star"]' // Newer UI patterns
    );

    if (starButton) {
      // Common parents are divs with flex display, or specific action group classes
      container = starButton.closest(
        "div.pagehead-actions, div.gh-header-actions, div.repository-actions, " +
          "div.hx_actions, div.d-flex.flex-wrap.gap-2.flex-items-center, " +
          'div[class*="AppHeader-actions"]' // More generic but might catch repo actions
      );
      if (container) return container;
    }

    // 3. Fallback if star button or its specific parent isn't found easily, try broader action containers.
    // This looks for a common layout pattern for repository actions.
    container = document.querySelector(
      ".repository-content .gh-header-actions, .repository-content .pagehead-actions, #repository-container-header .pagehead-actions"
    );
    if (container) return container;

    // Broader search for elements that look like they contain main repo actions
    const actionContainers = document.querySelectorAll(
      'div[class*="action"], ul[class*="action"]'
    );
    for (let el of actionContainers) {
      if (
        el.querySelector('a[href*="/stargazers"], button[aria-label*="Star"]')
      ) {
        return el;
      }
    }

    return null;
  }

  function addButtonIfMissing() {
    if (document.querySelector("." + BUTTON_MARKER_CLASS)) {
      return; // Button already exists
    }

    if (!isValidRepoPage()) {
      return;
    }

    const container = findButtonContainer();
    if (!container) {
      // console.log('[DeepWiki] Button container not found on this page.');
      return;
    }

    const deepWikiButton = document.createElement("a");
    deepWikiButton.href = "#"; // Actual navigation handled by click listener
    deepWikiButton.className = `btn btn-sm ${BUTTON_MARKER_CLASS}`;
    deepWikiButton.textContent = "DeepWiki";
    deepWikiButton.setAttribute("role", "button");
    deepWikiButton.setAttribute("aria-label", "Open in DeepWiki");
    deepWikiButton.style.whiteSpace = "nowrap"; // Prevent text wrapping

    if (
      container.tagName !== "UL" &&
      !container.classList.contains("pagehead-actions")
    ) {
      // Add some margin if it's directly appended to a div, not as an LI
      // or if the container is not the specific pagehead-actions ul (which has its own li styling)
      deepWikiButton.style.marginLeft = "8px";
    }

    deepWikiButton.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      const currentGithubUrl = window.location.href;
      if (currentGithubUrl.startsWith("https://github.com/")) {
        const deepWikiUrl = currentGithubUrl.replace(
          /^https:\/\/github\.com\//,
          "https://deepwiki.com/"
        );
        window.location.href = deepWikiUrl;
      } else {
        console.error(
          "[DeepWiki] Error: Current URL does not start with https://github.com/"
        );
      }
    });

    if (
      container.tagName === "UL" ||
      container.classList.contains("pagehead-actions")
    ) {
      const listItem = document.createElement("li");
      listItem.appendChild(deepWikiButton);
      container.appendChild(listItem);
    } else {
      // Attempt to insert it alongside other buttons rather than just at the end.
      const lastButtonOrGroup = container.querySelector(
        ".BtnGroup:last-of-type, form:last-of-type, .btn:last-of-type, details:last-of-type"
      );
      if (lastButtonOrGroup && lastButtonOrGroup.parentNode === container) {
        container.insertBefore(deepWikiButton, lastButtonOrGroup.nextSibling);
      } else {
        container.appendChild(deepWikiButton);
      }
    }

    // console.log('[DeepWiki] Button added.');
  }

  const observer = new MutationObserver(() => {
    // Use requestAnimationFrame to avoid layout thrashing and redundant calls.
    requestAnimationFrame(addButtonIfMissing);
  });

  // Initial attempt to add the button
  // Wait for document to be idle, then try.
  if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
  ) {
    addButtonIfMissing();
  } else {
    document.addEventListener("DOMContentLoaded", addButtonIfMissing);
  }

  observer.observe(document.body, { childList: true, subtree: true });
})();
