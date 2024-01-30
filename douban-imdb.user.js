// ==UserScript==
// @name        IMDb Info for Douban
// @version     1.0.0
// @description Show next episode date for TV series on douban
// @author      kaiix
// @namespace   https://github.com/kaiix
// @license     MIT
// @match       *://movie.douban.com/subject/*
// @grant       GM.xmlHttpRequest
// @icon        https://www.google.com/s2/favicons?sz=64&domain=imdb.com
// @updateURL   https://raw.githubusercontent.com/kaiix/userscripts/main/douban-imdb.user.js
// @downloadURL https://raw.githubusercontent.com/kaiix/userscripts/main/douban-imdb.user.js
// @supportURL  https://github.com/kaiix/userscripts/issues
// ==/UserScript==

"use strict";

function addIMDbInfo({ nextEpisodeDate, url, aggregateRating }) {
  const sidebar = document.getElementsByClassName("aside")[0];
  const div = document.createElement("div");
  const date = nextEpisodeDate.toLocaleDateString("zh-CN", {
    timeZone: "Asia/Shanghai",
  });
  div.innerHTML = `<div class="gray_ad" id="imdb_info">
  <h2>IMDb</h2>
  <span class="pl">下集播放时间:</span> ${date}<br>
  <span class="pl">评分:</span>  ${aggregateRating}<br>
  <a href="${url}" target="_blank"><span>更多</span></a><br>
  </div>`;
  sidebar.insertBefore(div, sidebar.firstChild);
}

function getInfoFieldValue(fields, label) {
  const node = fields.filter((el) => el.innerText.startsWith(label))[0];
  return node?.nextSibling.textContent.trim();
}

function getInfoFieldValueNode(fields, label) {
  const node = fields.filter((el) => el.innerText.startsWith(label))[0];
  return node?.nextElementSibling;
}

function fetchIMDbInfo(IMDbTitle, seasonId, callback) {
  const url = `https://www.imdb.com/title/${IMDbTitle}/episodes?season=${seasonId}`;
  const currentDate = new Date();
  GM.xmlHttpRequest({
    url: url,
    method: "GET",
    onload: function (response) {
      // ref: https://github.com/tuhinpal/imdb-api/blob/master/src/helpers/seriesFetcher.js
      let parser = new DOMParser();
      let dom = parser.parseFromString(response.responseText, "text/html");
      const nextData = dom.getElementById("__NEXT_DATA__");
      const json = JSON.parse(nextData.textContent);
      const episodes = json.props.pageProps.contentData.section.episodes.items;
      const episodesInfo = Object.values(episodes).map((e, i) => {
        return {
          idx: i + 1,
          no: e.episode,
          title: e.titleText,
          publishedDate: new Date(
            e.releaseDate.year,
            e.releaseDate.month - 1,
            e.releaseDate.day,
          ),
        };
      });
      const futureEpisodes = episodesInfo.filter(
        (episode) => episode.publishedDate > currentDate,
      );
      const nextEpisode = futureEpisodes[0];
      callback({
        url: url,
        nextEpisodeDate: nextEpisode.publishedDate,
        aggregateRating:
          json.props.pageProps.contentData.entityMetadata.ratingsSummary
            .aggregateRating,
      });
    },
  });
}

function showIMDbInfo() {
  const fields = Array.from(document.querySelectorAll("#info > span"));

  // Skip movies
  const episodesCountStr = getInfoFieldValue(fields, "集数");
  if (!episodesCountStr) {
    return;
  }

  // e.g. 2024-01-14(美国)
  const releaseDateNode = getInfoFieldValueNode(fields, "首播");
  const releaseDate = new Date(releaseDateNode.textContent.split("(")[0]);

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(new Date().getFullYear() - 1);
  if (releaseDate < oneYearAgo) {
    return;
  }

  const seasonSelectionNode = getInfoFieldValueNode(fields, "季数");
  const currentSeason = seasonSelectionNode
    ? seasonSelectionNode.selectedIndex + 1
    : 1;
  if (currentSeason > 1) {
    const firstSeasonId = seasonSelectionNode.options[0].value;
    GM.xmlHttpRequest({
      url: "https://movie.douban.com/subject/" + firstSeasonId,
      method: "GET",
      onload: function (response) {
        // ref: https://github.com/tuhinpal/imdb-api/blob/master/src/helpers/seriesFetcher.js
        let parser = new DOMParser();
        let dom = parser.parseFromString(response.responseText, "text/html");
        const fields = Array.from(dom.querySelectorAll("#info > span"));
        const IMDbTitle = getInfoFieldValue(fields, "IMDb");
        fetchIMDbInfo(IMDbTitle, currentSeason, addIMDbInfo);
      },
    });
  } else {
    const IMDbTitle = getInfoFieldValue(fields, "IMDb");
    fetchIMDbInfo(IMDbTitle, currentSeason, addIMDbInfo);
  }
}

showIMDbInfo();
