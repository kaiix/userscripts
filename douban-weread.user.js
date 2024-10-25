// ==UserScript==
// @name         Douban to WeRead
// @version      1.0.0
// @description  Add books from Douban to WeRead library
// @author       kaiix
// @namespace    https://github.com/kaiix
// @license      MIT
// @match        https://book.douban.com/subject/*
// @grant        GM_xmlhttpRequest
// @require      https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js
// @icon         https://weread.qq.com/favicon.ico
// @updateURL    https://raw.githubusercontent.com/kaiix/userscripts/main/douban-weread.user.js
// @downloadURL  https://raw.githubusercontent.com/kaiix/userscripts/main/douban-weread.user.js
// @supportURL   https://github.com/kaiix/userscripts/issues
// ==/UserScript==

(function () {
  "use strict";

  const WEREAD_SEARCH_URL = "https://weread.qq.com/web/search/global";
  const WEREAD_ADD_BOOK_URL = "https://weread.qq.com/mp/shelf/addToShelf";
  const WEREAD_BOOK_URL_PREFIX = "https://weread.qq.com/web/reader/";
  const WEREAD_SEARCH_COUNT = 1;

  function addWeReadBlock() {
    const sidebarElem = document.querySelector("#content .aside");
    if (!sidebarElem) return;

    const wereadBlock = document.createElement("div");
    wereadBlock.className = "gray_ad";
    wereadBlock.innerHTML = `
            <h2>
                添加到微信读书
                <span class="pl">
                    &nbsp;·&nbsp;·&nbsp;·&nbsp;·&nbsp;·&nbsp;·
                </span>
            </h2>
            <div id="weread-results"></div>
        `;

    // Insert the WeRead block at the beginning of the sidebar
    sidebarElem.insertBefore(wereadBlock, sidebarElem.firstChild);
    searchWeRead();
  }

  function searchWeRead() {
    const title = document.querySelector("h1 span").textContent.trim();
    console.log("title", title);
    const metadata = document.querySelector("#info");
    const metadataDict = {};
    if (metadata) {
      const lines = metadata.innerText.split("\n").filter(Boolean);
      lines.forEach((line) => {
        const [key, value] = line.split(":").map((s) => s.trim());
        metadataDict[key] = value;
      });
    }
    console.log("Metadata:", metadataDict);

    const searchKeyword = [title, metadataDict["作者"], metadataDict["副标题"]]
      .filter(Boolean)
      .join(" ");
    console.log("searchKeyword", searchKeyword);

    GM_xmlhttpRequest({
      method: "GET",
      url: `${WEREAD_SEARCH_URL}?keyword=${encodeURIComponent(
        searchKeyword
      )}&count=${WEREAD_SEARCH_COUNT}`,
      onload: function (response) {
        console.log("url", response.finalUrl);
        const books = JSON.parse(response.responseText).books;
        console.log("books", books);
        displayWeReadResults(books);
      },
    });
  }

  function displayWeReadResults(books) {
    const resultsElem = document.querySelector("#weread-results");
    if (!books || books.length === 0) {
      resultsElem.innerHTML = "<p>未在微信读书中找到匹配的图书。</p>";
      return;
    }

    const bookIds = books.map((book) => book.bookInfo.bookId).join(",");
    checkShelfStatus(bookIds, (shelfStatus) => {
      let html = '<ul style="list-style-type: none; padding: 0;">';
      books.forEach((book) => {
        const bookInfo = book.bookInfo;
        const readerUrl = `${WEREAD_BOOK_URL_PREFIX}${getBookHash(
          bookInfo.bookId
        )}`;
        const isInShelf = shelfStatus[bookInfo.bookId];
        html += `
          <li style="margin-bottom: 10px;">
            <img src="${bookInfo.cover}" alt="${
          bookInfo.title
        }" style="width: 60px; float: left; margin-right: 10px;">
            <div>
              <strong><a href="${readerUrl}" target="_blank">${
          bookInfo.title
        }</a></strong><br>
              ${bookInfo.author}<br>
              ${
                isInShelf
                  ? '<span style="color: green;">已在书架中</span>'
                  : `<button class="add-to-weread" style="padding:0 2px;" data-bookid="${bookInfo.bookId}">添加到书架</button>`
              }
            </div>
            <div style="clear: both;"></div>
          </li>
        `;
      });
      html += "</ul>";

      resultsElem.innerHTML = html;
      addWeReadButtonListeners();
    });
  }

  function checkShelfStatus(bookIds, callback) {
    GM_xmlhttpRequest({
      method: "GET",
      url: `https://weread.qq.com/web/shelf/bookIds?bookIds=${bookIds}`,
      onload: function (response) {
        const result = JSON.parse(response.responseText);
        const shelfStatus = {};
        result.data.forEach((item) => {
          shelfStatus[item.bookId] = item.onShelf === 1;
        });
        callback(shelfStatus);
      },
      onerror: function (error) {
        console.error("Error checking shelf status:", error);
        callback({});
      },
    });
  }

  function addWeReadButtonListeners() {
    const buttons = document.querySelectorAll(".add-to-weread");
    buttons.forEach((button) => {
      button.addEventListener("click", function () {
        const bookId = this.getAttribute("data-bookid");
        addToWeRead(bookId);
      });
    });
  }

  function getTransformedBookId(id) {
    if (/^\d*$/.test(id)) {
      const c = [];
      for (let a = 0; a < id.length; a += 9) {
        const b = id.slice(a, Math.min(a + 9, id.length));
        c.push(parseInt(b, 10).toString(16));
      }
      return ["3", c];
    }
    let d = "";
    for (let i = 0; i < id.length; i++) {
      d += id.charCodeAt(i).toString(16);
    }
    return ["4", [d]];
  }

  function getBookHash(bookId) {
    const idHash = CryptoJS.MD5(bookId).toString(CryptoJS.enc.Hex);
    const [code, transformIds] = getTransformedBookId(bookId);
    let bookHash = idHash.substr(0, 3);
    bookHash += code;
    bookHash += "2" + idHash.substr(idHash.length - 2, 2);

    for (let j = 0; j < transformIds.length; j++) {
      const n = transformIds[j].length.toString(16);
      if (n.length === 1) {
        bookHash += "0" + n;
      } else {
        bookHash += n;
      }
      bookHash += transformIds[j];
      if (j < transformIds.length - 1) {
        bookHash += "g";
      }
    }

    if (bookHash.length < 20) {
      bookHash += idHash.substr(0, 20 - bookHash.length);
    }

    bookHash += CryptoJS.MD5(bookHash).toString(CryptoJS.enc.Hex).substr(0, 3);
    return bookHash;
  }

  function addToWeRead(bookId) {
    GM_xmlhttpRequest({
      method: "POST",
      url: WEREAD_ADD_BOOK_URL,
      data: JSON.stringify({ bookIds: [bookId] }),
      headers: {
        "Content-Type": "application/json",
      },
      onload: function (response) {
        const result = JSON.parse(response.responseText);
        if (result.status === 200) {
          alert("成功添加到微信读书书架！");
        } else {
          alert("添加失败，请稍后重试。");
        }
      },
    });
  }

  addWeReadBlock();
})();
