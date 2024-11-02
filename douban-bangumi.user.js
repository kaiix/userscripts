// ==UserScript==
// @name         Douban Bangumi Score
// @version      1.0.1
// @description  Show Bangumi scores on Douban anime pages
// @author       kaiix
// @namespace    https://github.com/kaiix/userscripts
// @license      MIT
// @match        https://movie.douban.com/subject/*
// @grant        GM_xmlhttpRequest
// @icon         https://bgm.tv/img/favicon.ico
// @connect      api.bgm.tv
// @updateURL    https://raw.githubusercontent.com/kaiix/userscripts/main/douban-bangumi.user.js
// @downloadURL  https://raw.githubusercontent.com/kaiix/userscripts/main/douban-bangumi.user.js
// @supportURL   https://github.com/kaiix/userscripts/issues
// ==/UserScript==

(function () {
  "use strict";

  if (!isAnimePage()) return;

  const metaKeywords = document.querySelector('meta[name="keywords"]');
  const title = metaKeywords
    ? metaKeywords.content.split(",")[0].trim()
    : document.querySelector('h1 span[property="v:itemreviewed"]').textContent;

  searchBangumi(title);

  function isAnimePage() {
    const genres = document.querySelectorAll('span[property="v:genre"]');
    return Array.from(genres).some((genre) => genre.textContent === "动画");
  }

  function searchBangumi(title) {
    GM_xmlhttpRequest({
      method: "GET",
      url: `https://api.bgm.tv/search/subject/${encodeURIComponent(
        title
      )}?type=2`,
      headers: {
        Accept: "application/json",
      },
      onload: function (response) {
        try {
          const data = JSON.parse(response.responseText);
          if (data.list && data.list.length > 0) {
            const subjectId = data.list[0].id;
            fetchBangumiScore(subjectId);
          }
        } catch (e) {
          console.error("Error parsing Bangumi search results:", e);
        }
      },
    });
  }

  function fetchBangumiScore(subjectId) {
    GM_xmlhttpRequest({
      method: "GET",
      url: `https://api.bgm.tv/subject/${subjectId}`,
      headers: {
        Accept: "application/json",
      },
      onload: function (response) {
        try {
          const data = JSON.parse(response.responseText);
          console.log("bgm data", data);
          if (data.air_date) {
            const [year, month] = data.air_date.split("-");
            fetchMonthlyRanking(year, month, data);
          } else {
            displayBangumiScore(data);
          }
        } catch (e) {
          console.error("Error parsing Bangumi subject data:", e);
        }
      },
    });
  }

  function fetchMonthlyRanking(year, month, subjectData) {
    GM_xmlhttpRequest({
      method: "GET",
      url: `https://api.bgm.tv/v0/subjects?type=2&sort=rank&year=${year}&month=${month}`,
      headers: {
        Accept: "application/json",
      },
      onload: function (response) {
        try {
          const { data } = JSON.parse(response.responseText);
          const monthRank =
            data.findIndex((item) => item.id === subjectData.id) + 1;
          if (monthRank > 0) {
            subjectData.month_rank = monthRank;
          }
          displayBangumiScore(subjectData);
        } catch (e) {
          console.error("Error parsing monthly ranking data:", e);
          displayBangumiScore(subjectData);
        }
      },
    });
  }

  function displayBangumiScore({ url, rating, rank, month_rank }) {
    const ratingSection = document.querySelector("#interest_sectl");

    if (ratingSection) {
      const bangumiScoreDiv = document.createElement("div");
      bangumiScoreDiv.className = "rating_wrap clearbox";
      bangumiScoreDiv.innerHTML = `
        <div class="clearfix">
          <div class="rating_logo">Bangumi</div>
          <div class="rating_self clearfix">
            <strong class="ll rating_num">${rating.score}</strong>
            <div class="rating_right">
              <div class="rating_sum">
                <a href="${url}" target="_blank"><span class="rating_people">${
        rating.total
      }人评分</span></a>
              </div>
              ${rank ? `<div class="rating_sum">全站排名: ${rank}</div>` : ""}
              ${
                month_rank
                  ? `<div class="rating_sum">月排名: ${month_rank}</div>`
                  : ""
              }
            </div>
          </div>
        </div>
      `;

      ratingSection.appendChild(bangumiScoreDiv);
    }
  }
})();
