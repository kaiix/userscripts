// ==UserScript==
// @name         Linear Board Reactions
// @version      0.4
// @description  Display reactions on Linear board cards
// @author       kaiix
// @namespace    https://github.com/kaiix
// @license      MIT
// @match        https://linear.app/*/view/*
// @grant        GM_xmlhttpRequest
// @icon        https://www.linear.app/favicon.ico
// @updateURL   https://raw.githubusercontent.com/kaiix/userscripts/main/linear-board-reactions.user.js
// @downloadURL https://raw.githubusercontent.com/kaiix/userscripts/main/linear-board-reactions.user.js
// @supportURL  https://github.com/kaiix/userscripts/issues
// ==/UserScript==

(function () {
  "use strict";

  let issueReactionsMap = new Map();
  let lastUrl = location.href;

  const emojiMap = {
    "+1": "👍",
    "-1": "👎",
    point_up_2: "👆",
    laugh: "😄",
    hooray: "🎉",
    confused: "😕",
    heart: "❤️",
    rocket: "🚀",
    eyes: "👀",
  };

  const getEmojiCharacter = (emoji) => {
    return emojiMap[emoji] || emoji;
  };

  const getViewIdFromUrl = (url) => {
    const match = url.match(/view\/([a-zA-Z0-9-]+)/);
    return match ? match[1] : null;
  };

  const getIssueIdFromCard = (card) => {
    const href = card.getAttribute("href");
    const match = href.match(/issue\/([A-Z]+-\d+|[a-f0-9-]+)/);
    if (match) {
      return match[1];
    }
    return null;
  };

  const getClientApiHeaders = () => {
    try {
      const appStore = JSON.parse(localStorage.getItem("ApplicationStore"));
      const organizationId = localStorage.getItem("ajs_group_id");
      const clientId = localStorage.getItem("clientId");
      const buildRevision = unsafeWindow.__RELEASE_INFO.BUILD_REVISION;

      if (appStore && buildRevision) {
        const { activeOrganizationId, currentUserId, currentUserAccountId } =
          appStore;
        return {
          "Content-Type": "application/json",
          organization: organizationId,
          user: currentUserId,
          useraccount: currentUserAccountId,
          "linear-client-id": clientId,
          "linear-client-version": `1.${buildRevision}.0`,
        };
      }
    } catch (e) {
      console.error(
        "Linear Reactions Userscript: Error getting client API headers",
        e
      );
    }
    return null;
  };

  const fetchReactionsForView = (viewId, callback) => {
    const headers = getClientApiHeaders();
    if (!headers) {
      console.error(
        "Linear Reactions Userscript: Could not get client API headers."
      );
      callback(null);
      return;
    }
    const query = `
        query CustomViewIssuesWithReactions($id: String!) {
          customView(id: $id) {
            issues {
              nodes {
                identifier
                reactions {
                  emoji
                }
              }
            }
          }
        }`;

    GM_xmlhttpRequest({
      method: "POST",
      url: "https://client-api.linear.app/graphql",
      headers: headers,
      data: JSON.stringify({
        query: query,
        variables: {
          id: viewId,
        },
      }),
      onload: function (response) {
        if (response.status === 200) {
          const jsonResponse = JSON.parse(response.responseText);
          if (jsonResponse.data && jsonResponse.data.customView) {
            const issues = jsonResponse.data.customView.issues.nodes;
            const reactionsMap = new Map();
            issues.forEach((issue) => {
              const reactions = issue.reactions.map((node) => ({
                emoji: node.emoji,
              }));
              reactionsMap.set(issue.identifier, reactions);
            });
            callback(reactionsMap);
          } else {
            console.error(
              "Failed to parse reactions from response",
              jsonResponse
            );
            callback(null);
          }
        } else {
          console.error(
            `Failed to fetch reactions for view ${viewId}`,
            response
          );
          callback(null);
        }
      },
      onerror: function (error) {
        console.error(`Error fetching reactions for view ${viewId}`, error);
        callback(null);
      },
    });
  };

  const displayReactions = (card, reactions) => {
    if (!reactions || reactions.length === 0) {
      return;
    }

    const reactionsMap = new Map();
    reactions.forEach((reaction) => {
      if (reactionsMap.has(reaction.emoji)) {
        reactionsMap.set(reaction.emoji, reactionsMap.get(reaction.emoji) + 1);
      } else {
        reactionsMap.set(reaction.emoji, 1);
      }
    });

    let reactionsContainer = card.querySelector(".reactions-container");
    if (!reactionsContainer) {
      if (getComputedStyle(card).position === "static") {
        card.style.position = "relative";
      }
      reactionsContainer = document.createElement("div");
      reactionsContainer.className = "reactions-container";
      reactionsContainer.style.position = "absolute";
      reactionsContainer.style.bottom = "8px";
      reactionsContainer.style.right = "8px";
      reactionsContainer.style.display = "flex";
      reactionsContainer.style.gap = "4px";
      reactionsContainer.style.zIndex = "1";
      card.appendChild(reactionsContainer);
    }

    reactionsContainer.innerHTML = "";

    for (const [emoji, count] of reactionsMap.entries()) {
      const reactionElement = document.createElement("div");
      reactionElement.className = "reaction";
      reactionElement.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
      reactionElement.style.border = "1px solid rgba(255, 255, 255, 0.1)";
      reactionElement.style.borderRadius = "10px";
      reactionElement.style.padding = "2px 6px";
      reactionElement.style.fontSize = "12px";
      reactionElement.style.color = "#e2e2e2";
      reactionElement.textContent = `${getEmojiCharacter(emoji)} ${count}`;
      reactionsContainer.appendChild(reactionElement);
    }
  };

  const processCard = (card) => {
    if (card.offsetParent === null) {
      return;
    }

    const issueId = getIssueIdFromCard(card);
    if (
      issueId &&
      issueReactionsMap.has(issueId) &&
      !card.dataset.reactionsDisplayed
    ) {
      displayReactions(card, issueReactionsMap.get(issueId));
      card.dataset.reactionsDisplayed = "true";
    }
  };

  const processAllCards = () => {
    document.querySelectorAll('[data-board-item="true"]').forEach(processCard);
  };

  const loadReactionsForCurrentView = () => {
    const viewId = getViewIdFromUrl(location.href);
    if (viewId) {
      fetchReactionsForView(viewId, (reactionsMap) => {
        if (reactionsMap) {
          issueReactionsMap = reactionsMap;
          processAllCards();
        }
      });
    }
  };

  const observeDOM = () => {
    loadReactionsForCurrentView();

    const observer = new MutationObserver((mutations) => {
      // Handle URL changes for SPA navigation
      const currentUrl = location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        if (currentUrl.includes("/view/")) {
          issueReactionsMap.clear();
          document
            .querySelectorAll('[data-board-item="true"]')
            .forEach((card) => {
              delete card.dataset.reactionsDisplayed;
              const container = card.querySelector(".reactions-container");
              if (container) container.remove();
            });
          // Re-process cards on the board after a short delay
          setTimeout(loadReactionsForCurrentView, 500);
        }
      }

      mutations.forEach((mutation) => {
        if (mutation.addedNodes.length) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1) {
              // ELEMENT_NODE
              if (node.matches('[data-board-item="true"]')) {
                processCard(node);
              }
              const cards = node.querySelectorAll('[data-board-item="true"]');
              cards.forEach(processCard);
            }
          });
        }
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  };

  observeDOM();
})();
