// ==UserScript==
// @name        YouTube Hold to Speed Up
// @version     1.1.1
// @description Hold the Right Arrow key to speed up YouTube playback
// @author      kaiix
// @namespace   https://github.com/kaiix
// @license     MIT
// @match       https://www.youtube.com/*
// @icon        https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_registerMenuCommand
// @run-at      document-start
// @updateURL   https://raw.githubusercontent.com/kaiix/userscripts/main/youtube-hold-speed.user.js
// @downloadURL https://raw.githubusercontent.com/kaiix/userscripts/main/youtube-hold-speed.user.js
// @supportURL  https://github.com/kaiix/userscripts/issues
// ==/UserScript==

(function () {
  "use strict";

  const SPEED_KEY = "youtube_hold_speed";
  const DEFAULT_SPEED = 2;
  const MIN_SPEED = 1.25;
  const MAX_SPEED = 16;
  const HOLD_DELAY_MS = 350;
  const SEEK_SECONDS = 5;

  let speedMultiplier = getSavedSpeed();
  let holdState = null;
  let speedIndicator = null;

  function getSavedSpeed() {
    const value = Number(GM_getValue(SPEED_KEY, DEFAULT_SPEED));
    return isValidSpeed(value) ? value : DEFAULT_SPEED;
  }

  function isValidSpeed(value) {
    return Number.isFinite(value) && value >= MIN_SPEED && value <= MAX_SPEED;
  }

  function configureSpeed() {
    const input = prompt(
      `Speed multiplier while holding → (${MIN_SPEED}–${MAX_SPEED}):`,
      speedMultiplier
    );

    if (input === null) return;

    const value = Number(input);
    if (!isValidSpeed(value)) {
      alert(`Enter a number between ${MIN_SPEED} and ${MAX_SPEED}.`);
      return;
    }

    speedMultiplier = value;
    GM_setValue(SPEED_KEY, value);
  }

  function getVideo() {
    return (
      document.querySelector("video.html5-main-video") ||
      document.querySelector("video")
    );
  }

  function showSpeedIndicator(video, speed) {
    const player = video.closest(".html5-video-player") || video.parentElement;
    if (!player) return;

    if (!speedIndicator) {
      speedIndicator = document.createElement("div");
      speedIndicator.setAttribute("role", "status");
      speedIndicator.setAttribute("aria-live", "polite");
      speedIndicator.setAttribute("aria-atomic", "true");
      speedIndicator.style.cssText = `
        position: absolute;
        top: clamp(12px, 5%, 40px);
        left: 50%;
        z-index: 2147483647;
        padding: 6px 10px;
        transform: translateX(-50%);
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.35);
        color: #fff;
        font: 600 clamp(14px, 2vw, 20px) / 1.2 Roboto, Arial, sans-serif;
        letter-spacing: -0.01em;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
        white-space: nowrap;
        pointer-events: none;
        user-select: none;
      `;
    }

    if (speedIndicator.parentElement !== player) {
      player.append(speedIndicator);
    }

    speedIndicator.textContent = `${Number(speed.toFixed(2))}×`;
    speedIndicator.hidden = false;
  }

  function hideSpeedIndicator() {
    if (speedIndicator) speedIndicator.hidden = true;
  }

  function isEditableTarget(target) {
    return (
      target instanceof Element &&
      Boolean(
        target.closest(
          'input, textarea, select, [contenteditable="true"], [role="slider"], [role="textbox"], [role="spinbutton"]'
        )
      )
    );
  }

  function suppressEvent(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function beginHold(video) {
    const state = {
      video,
      timer: 0,
      longPress: false,
      speedApplied: false,
      originalRate: video.playbackRate,
    };

    state.timer = window.setTimeout(() => {
      if (holdState !== state) return;

      state.longPress = true;
      state.originalRate = video.playbackRate;

      try {
        video.playbackRate = speedMultiplier;
        state.speedApplied = true;
        showSpeedIndicator(video, video.playbackRate);
      } catch (error) {
        console.error("[YouTube Hold to Speed Up] Could not change speed", error);
      }
    }, HOLD_DELAY_MS);

    holdState = state;
  }

  function seekForward(video) {
    const nextTime = video.currentTime + SEEK_SECONDS;
    video.currentTime = Number.isFinite(video.duration)
      ? Math.min(nextTime, video.duration)
      : nextTime;
  }

  function finishHold(shouldSeek) {
    const state = holdState;
    if (!state) return;

    holdState = null;
    window.clearTimeout(state.timer);
    hideSpeedIndicator();

    if (state.longPress) {
      if (state.speedApplied) {
        state.video.playbackRate = state.originalRate;
      }
      return;
    }

    if (shouldSeek) {
      seekForward(state.video);
    }
  }

  function handleKeyDown(event) {
    if (event.key !== "ArrowRight") return;

    if (holdState) {
      suppressEvent(event);
      return;
    }

    if (
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.isComposing ||
      isEditableTarget(event.target)
    ) {
      return;
    }

    const video = getVideo();
    if (!video || video.paused || video.ended) return;

    suppressEvent(event);
    beginHold(video);
  }

  function handleKeyUp(event) {
    if (event.key !== "ArrowRight" || !holdState) return;

    suppressEvent(event);
    finishHold(true);
  }

  GM_registerMenuCommand("Configure hold speed", configureSpeed);

  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("keyup", handleKeyUp, true);
  window.addEventListener("blur", () => finishHold(false));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) finishHold(false);
  });
})();
