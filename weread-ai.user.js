// ==UserScript==
// @name         WeRead AI Selection Search
// @version      1.0.1
// @description  Search selected text using WeRead AI search
// @author       kaiix
// @namespace    https://github.com/kaiix/userscripts
// @license      MIT
// @match        *://*/*
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_getResourceURL
// @icon         https://weread.qq.com/favicon.ico
// @updateURL    https://raw.githubusercontent.com/kaiix/userscripts/main/weread-ai.user.js
// @downloadURL  https://raw.githubusercontent.com/kaiix/userscripts/main/weread-ai.user.js
// @supportURL   https://github.com/kaiix/userscripts/issues
// @require      https://cdn.jsdelivr.net/npm/marked/marked.min.js
// @resource     ICON https://rescdn.qqmail.com/node/wr/wrpage/style/images/independent/favicon/favicon_32h.png
// ==/UserScript==

(function () {
  "use strict";

  const WEREAD_AI_URL = "https://weread.qq.com/web/ai/query_session_id";
  const WEREAD_LOGIN_CHECK = "https://weread.qq.com";

  const markdownStyles = document.createElement("style");
  markdownStyles.textContent = `
    .weread-markdown-content {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    .weread-markdown-content h1, .weread-markdown-content h2, .weread-markdown-content h3 {
      margin-top: 24px;
      margin-bottom: 16px;
      font-weight: 600;
      line-height: 1.25;
    }
    .weread-markdown-content p {
      margin-bottom: 16px;
      line-height: 1.6;
    }
    .weread-markdown-content code {
      padding: 0.2em 0.4em;
      background-color: rgba(27,31,35,0.05);
      border-radius: 3px;
      font-family: SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
    }
    .weread-markdown-content pre {
      padding: 16px;
      overflow: auto;
      background-color: #f6f8fa;
      border-radius: 3px;
    }
    .weread-markdown-content blockquote {
      padding: 0 1em;
      color: #6a737d;
      border-left: 0.25em solid #dfe2e5;
      margin: 0 0 16px 0;
    }
    .weread-markdown-content ul, .weread-markdown-content ol {
      padding-left: 2em;
      margin-bottom: 16px;
    }

    .weread-popup {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      z-index: 10000;
      max-width: 600px;
      width: 80%;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
    }

    .weread-popup-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 24px;
      border-bottom: 1px solid #eee;
    }

    .weread-popup-title {
      margin: 0;
      font-size: 18px;
    }

    .weread-close-button {
      border: none;
      background: none;
      padding: 4px;
      cursor: pointer;
      font-size: 20px;
      color: #999;
    }

    .weread-popup-content {
      flex: 1;
      overflow-y: auto;
      padding: 20px 24px;
    }

    .weread-response-content {
      line-height: 1.8;
      font-size: 18px;
      color: #333;
    }

    .weread-anchor-content {
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid #eee;
      font-size: 16px;
      color: #666;
    }

    .weread-anchor-header {
      color: #999;
      margin-bottom: 12px;
    }

    .weread-anchor-item {
      margin-bottom: 16px;
    }

    .weread-anchor-link {
      color: #3374e0;
      text-decoration: none;
      margin-bottom: 8px;
      display: block;
    }

    .weread-anchor-text {
      color: #666;
      line-height: 1.6;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .weread-markdown-content a {
      color: #3374e0;
      text-decoration: none;
      padding: 0 2px;
    }

    .weread-markdown-content a::before {
      content: '[';
    }
    .weread-markdown-content a::after {
      content: ']';
    }

    .weread-selection-icon {
      position: absolute;
      width: 32px;
      height: 32px;
      background-image: url('${GM_getResourceURL("ICON")}');
      background-size: contain;
      background-position: center;
      background-repeat: no-repeat;
      background-color: #1b88ee;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      z-index: 10000;
      transform: translateX(16px);
      transition: transform 0.2s ease;
    }

    .weread-selection-icon:hover {
      transform: translateX(0);
    }
  `;
  document.head.appendChild(markdownStyles);

  GM_registerMenuCommand("Search with WeRead AI", () => {
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
      searchWithWeReadAI(selectedText);
    } else {
      alert("Please select some text first!");
    }
  });

  async function searchWithWeReadAI(text) {
    const selectedText = text || window.getSelection().toString().trim();
    if (selectedText) {
      try {
        const popup = createPopup(selectedText);
        const responseDiv = popup.querySelector(".weread-response-content");
        document.body.appendChild(popup);

        popup.abortController = new AbortController();
        popup.dataset.active = "true";

        const initResponse = await makeRequest(
          {
            query: selectedText,
          },
          popup.abortController.signal
        );

        if (initResponse.errcode !== 0 || !initResponse.session_id) {
          throw new Error("Failed to initialize session");
        }

        let currentResponse = initResponse;
        while (currentResponse.has_more && popup.dataset.active === "true") {
          await new Promise((resolve) =>
            setTimeout(resolve, currentResponse.request_interval || 200)
          );

          currentResponse = await makeRequest(
            {
              query: selectedText,
              sessionId: currentResponse.session_id,
              apiVersion: 1,
            },
            popup.abortController.signal
          );

          if (currentResponse.errcode !== 0 && !currentResponse.data) {
            throw new Error("Failed to get response");
          }

          const answerData = currentResponse.data?.find(
            (item) => item.type === 8
          );
          const anchorData = currentResponse.data?.find(
            (item) => item.type === 9
          );

          if (answerData?.markdown) {
            responseDiv.className =
              "weread-response-content weread-markdown-content";
            const parsedContent = marked.parse(answerData.markdown);
            console.log("parsedContent", parsedContent);
            responseDiv.innerHTML = parsedContent;
          } else if (
            !currentResponse.has_more &&
            (!answerData || !answerData.markdown)
          ) {
            responseDiv.innerHTML = "No answer found 🤔";
          }

          if (anchorData?.anchor_datas) {
            const anchorDiv = popup.querySelector(".weread-anchor-content");
            anchorDiv.innerHTML = `
              <div class="weread-anchor-header">以下为书籍引用</div>
              ${anchorData.anchor_datas
                .map(
                  (anchor, index) => `
                <div class="weread-anchor-item">
                  <a id="${anchor.anchor}" href="${
                    anchor.web_url
                  }" target="_blank" class="weread-anchor-link">[${
                    index + 1
                  }] 引自${anchor.title}</a>
                  <div class="weread-anchor-text">${anchor.anchorText}</div>
                </div>
              `
                )
                .join("")}
            `;
          }
        }
      } catch (error) {
        if (error.name === "AbortError") {
          console.log("Request aborted");
          return;
        }
        console.error("Error fetching WeRead AI response:", error);
        alert("Failed to get response from WeRead AI");
      }
    }
  }

  async function refreshWeReadCookies() {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: WEREAD_LOGIN_CHECK,
        headers: {
          "Content-Type": "application/json",
        },
        onload: (response) => {
          if (response.status >= 200 && response.status < 300) {
            resolve(true);
          } else {
            reject(new Error(`HTTP ${response.status}`));
          }
        },
        onerror: (error) => reject(error),
      });
    });
  }

  function makeRequest(payload, signal, retryCount = 0) {
    const MAX_RETRIES = 1;

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: WEREAD_AI_URL,
        headers: {
          "Content-Type": "application/json",
        },
        data: JSON.stringify(payload),
        signal,
        onload: async (response) => {
          if (response.status >= 200 && response.status < 300) {
            const data = JSON.parse(response.responseText);

            // Handle login timeout error
            if (data.errCode === -2012 && retryCount < MAX_RETRIES) {
              try {
                await refreshWeReadCookies();
                const retryResponse = await makeRequest(
                  payload,
                  signal,
                  retryCount + 1
                );
                resolve(retryResponse);
              } catch (error) {
                reject(new Error("Failed to refresh login session"));
              }
            } else {
              resolve(data);
            }
          } else {
            reject(new Error(`HTTP ${response.status}`));
          }
        },
        onerror: (error) => reject(error),
      });
    });
  }

  function createPopup(query) {
    const popup = document.createElement("div");
    popup.className = "weread-popup";

    popup.innerHTML = `
      <div class="weread-popup-header">
        <h3 class="weread-popup-title">WeRead AI Search</h3>
        <button class="weread-close-button" onclick="this.parentElement.parentElement.remove()">×</button>
      </div>
      <div class="weread-popup-content">
        <div class="weread-response-content">
          <em>Loading answer...</em>
        </div>
        <div class="weread-anchor-content"></div>
      </div>
    `;

    const handleClickOutside = (event) => {
      if (!popup.contains(event.target)) {
        popup.dataset.active = "false";
        popup.abortController?.abort();
        popup.remove();
        document.removeEventListener("mousedown", handleClickOutside);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);

    popup.querySelector("button").onclick = () => {
      popup.dataset.active = "false";
      popup.abortController?.abort();
      popup.remove();
      document.removeEventListener("mousedown", handleClickOutside);
    };

    return popup;
  }

  document.addEventListener("mouseup", (e) => {
    if (e.target.classList.contains("weread-selection-icon")) {
      return;
    }

    const existingIcon = document.querySelector(".weread-selection-icon");
    if (existingIcon) {
      existingIcon.onclick = null;
      existingIcon.remove();
    }

    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    if (selectedText) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      const icon = document.createElement("div");
      icon.className = "weread-selection-icon";

      icon.dataset.selectedText = selectedText;

      icon.style.position = "fixed";
      icon.style.right = "0px";
      icon.style.top = `${rect.top}px`;

      icon.onclick = (e) => {
        console.log("search with AI", icon.dataset.selectedText);
        e.stopPropagation();
        searchWithWeReadAI(icon.dataset.selectedText);
        icon.remove();
      };

      document.body.appendChild(icon);
    }
  });
})();
