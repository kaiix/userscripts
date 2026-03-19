// ==UserScript==
// @name         X/Twitter Timeline Last Read Position Saver (Advanced)
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Adds a floating button to hunt down and jump to your last read tweet.
// @author       Gemini
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_PREFIX = 'x_last_read_';
    const MAX_TWEETS_TO_SCAN = 2000;

    let scrollTimeout;
    let isRestoring = false;
    let hasUnusedSave = false; // Prevents overwriting save before jumping
    let floatingBtn = null;

    // --- Core Logic ---

    function getTimelineKey() {
        let key = window.location.pathname;
        if (window.location.pathname === '/home') {
            const activeTab = document.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]');
            if (activeTab) {
                key += '_' + activeTab.innerText.trim().replace(/\n/g, '');
            }
        }
        return key;
    }

    function getTopVisibleTweetId() {
        const tweets = document.querySelectorAll('article[data-testid="tweet"]');
        const headerOffset = 80;

        for (const tweet of tweets) {
            const rect = tweet.getBoundingClientRect();
            if (rect.top >= headerOffset || rect.bottom > headerOffset + 50) {
                const link = tweet.querySelector('a[href*="/status/"]');
                if (link) {
                    const match = link.href.match(/\/status\/(\d+)/);
                    if (match) return match[1];
                }
            }
        }
        return null;
    }

    function savePosition() {
        // Don't save if we are actively hunting or if the user hasn't clicked "Jump" yet
        if (isRestoring || hasUnusedSave) return;

        const key = getTimelineKey();
        const tweetId = getTopVisibleTweetId();

        if (key && tweetId) {
            localStorage.setItem(STORAGE_PREFIX + key, tweetId);
        }
    }

    // --- The Hunting Mechanism ---

    async function jumpToLastRead() {
        const key = getTimelineKey();
        const targetId = localStorage.getItem(STORAGE_PREFIX + key);

        if (!targetId) return;

        isRestoring = true;
        hasUnusedSave = false; // Now we can allow saving again once we finish
        const seenTweets = new Set();
        let found = false;

        updateButtonUI('Searching...', '#f5a623'); // Orange for searching

        // Hunting Loop
        while (seenTweets.size < MAX_TWEETS_TO_SCAN) {
            // 1. Abort if user switched tabs/pages while searching
            if (getTimelineKey() !== key) {
                removeButton();
                isRestoring = false;
                return;
            }

            // 2. Check if the target tweet is currently in the DOM
            const link = document.querySelector(`a[href*="/status/${targetId}"]`);
            if (link) {
                const tweet = link.closest('article');
                if (tweet) {
                    tweet.scrollIntoView({ behavior: 'smooth', block: 'center' });

                    // Highlight the found tweet
                    tweet.style.transition = 'background-color 0.4s ease';
                    tweet.style.backgroundColor = 'rgba(29, 155, 240, 0.25)';
                    setTimeout(() => { tweet.style.backgroundColor = 'transparent'; }, 2500);

                    found = true;
                    break;
                }
            }

            // 3. Keep track of how many unique tweets we've scanned
            const currentTweets = document.querySelectorAll('article[data-testid="tweet"]');
            currentTweets.forEach(t => {
                const l = t.querySelector('a[href*="/status/"]');
                if (l) {
                    const match = l.href.match(/\/status\/(\d+)/);
                    if (match) seenTweets.add(match[1]);
                }
            });

            // Update UI with progress
            updateButtonUI(`Scanning... (${seenTweets.size}/${MAX_TWEETS_TO_SCAN})`, '#f5a623');

            if (seenTweets.size >= MAX_TWEETS_TO_SCAN) break;

            // 4. Scroll down to force X to load more tweets
            window.scrollBy(0, window.innerHeight * 1.5);

            // Wait for X network request and DOM render
            await new Promise(resolve => setTimeout(resolve, 800));
        }

        // --- Post-Hunt Cleanup ---
        if (found) {
            updateButtonUI('Found it!', '#17bf63'); // Green
            setTimeout(removeButton, 2000);
        } else {
            updateButtonUI('Tweet missing or deleted', '#e0245e'); // Red
            setTimeout(removeButton, 3000);
            // Clear the bad save so it doesn't try again next time
            localStorage.removeItem(STORAGE_PREFIX + key);
        }

        setTimeout(() => { isRestoring = false; }, 1000);
    }

    // --- UI Button Logic ---

    function createButton() {
        if (document.getElementById('x-jump-btn')) return;

        floatingBtn = document.createElement('div');
        floatingBtn.id = 'x-jump-btn';
        floatingBtn.innerText = '↓ Jump to Last Read';

        // Styling
        Object.assign(floatingBtn.style, {
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            backgroundColor: 'rgba(29, 155, 240, 0.95)', // Twitter Blue
            color: 'white',
            padding: '12px 20px',
            borderRadius: '9999px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
            fontSize: '15px',
            fontWeight: 'bold',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            zIndex: '9999',
            transition: 'all 0.2s ease',
            userSelect: 'none'
        });

        // Add hover effect
        floatingBtn.onmouseenter = () => floatingBtn.style.transform = 'scale(1.05)';
        floatingBtn.onmouseleave = () => floatingBtn.style.transform = 'scale(1)';

        // Click action
        floatingBtn.onclick = jumpToLastRead;

        // Add close button (X) inside the floating button to dismiss it manually
        const closeBtn = document.createElement('span');
        closeBtn.innerText = ' ✕';
        closeBtn.style.marginLeft = '10px';
        closeBtn.style.color = 'rgba(255,255,255,0.7)';
        closeBtn.onclick = (e) => {
            e.stopPropagation(); // Don't trigger the jump
            removeButton();
            hasUnusedSave = false; // Allow saving again
        };
        floatingBtn.appendChild(closeBtn);

        document.body.appendChild(floatingBtn);
    }

    function updateButtonUI(text, bgColor) {
        if (floatingBtn) {
            floatingBtn.innerText = text;
            if (bgColor) floatingBtn.style.backgroundColor = bgColor;
        }
    }

    function removeButton() {
        if (floatingBtn) {
            floatingBtn.remove();
            floatingBtn = null;
        }
    }

    function checkAndShowButton() {
        const key = getTimelineKey();
        const savedTweetId = localStorage.getItem(STORAGE_PREFIX + key);

        if (savedTweetId) {
            hasUnusedSave = true; // Block overwriting the save temporarily
            createButton();
        } else {
            hasUnusedSave = false;
            removeButton();
        }
    }

    // --- Event Listeners ---

    // Save position as you scroll
    window.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(savePosition, 500);
    }, { passive: true });

    // Detect tab/page clicks
    document.addEventListener('click', (e) => {
        const tab = e.target.closest('[role="tab"], a[href^="/"]');
        if (tab) {
            setTimeout(checkAndShowButton, 600);
        }
    });

    // Initial load check
    window.addEventListener('load', () => {
        setTimeout(checkAndShowButton, 1000);
    });

})();
