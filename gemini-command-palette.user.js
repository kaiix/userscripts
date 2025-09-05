// ==UserScript==
// @name        Gemini Command Palette
// @version     1.1.0
// @description Adds a command palette to Gemini with keyboard shortcuts
// @author      kaiix
// @namespace   https://github.com/kaiix
// @license     MIT
// @match       https://gemini.google.com/*
// @grant       GM_addStyle
// @icon        https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @updateURL   https://raw.githubusercontent.com/kaiix/userscripts/main/gemini-command-palette.user.js
// @downloadURL https://raw.githubusercontent.com/kaiix/userscripts/main/gemini-command-palette.user.js
// @supportURL  https://github.com/kaiix/userscripts/issues
// ==/UserScript==

(function () {
  "use strict";

  // Command definitions
  const commands = [
    {
      id: "new-chat",
      title: "New Chat",
      description: "Start a new conversation",
      icon: "💬",
      action: () => startNewChat(),
    },
    {
      id: "new-temp-chat",
      title: "New Temporary Chat",
      description: "Start a new temporary conversation",
      icon: "👻",
      action: () => startNewTempChat(),
    },
    {
      id: "change-model",
      title: "Change Model",
      description: "Switch between Gemini models",
      icon: "🔄",
      action: () => changeModel(),
    },
    {
      id: "delete-chat",
      title: "Delete Current Chat",
      description: "Delete the current conversation",
      icon: "🗑️",
      action: () => deleteCurrentChat(),
    },
  ];

  let isOpen = false;
  let selectedIndex = 0;
  let paletteElement = null;

  // Add CSS styles
  GM_addStyle(`
    .gemini-command-palette {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 16px 70px rgba(0, 0, 0, 0.2);
      z-index: 10000;
      width: 640px;
      max-width: 90vw;
      max-height: 400px;
      overflow: hidden;
      font-family: 'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .gemini-command-palette-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.4);
      z-index: 9999;
      backdrop-filter: blur(2px);
    }

    .gemini-command-palette-header {
      padding: 16px 20px;
      border-bottom: 1px solid #e8eaed;
      background: #f8f9fa;
      border-radius: 12px 12px 0 0;
    }

    .gemini-command-palette-title {
      font-size: 14px;
      font-weight: 500;
      color: #3c4043;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .gemini-command-palette-shortcuts {
      font-size: 12px;
      color: #5f6368;
      margin-top: 4px;
    }

    .gemini-command-palette-list {
      padding: 8px 0;
      max-height: 300px;
      overflow-y: auto;
    }

    .gemini-command-item {
      padding: 12px 20px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 12px;
      transition: background-color 0.15s ease;
      border: none;
      background: none;
      width: 100%;
      text-align: left;
    }

    .gemini-command-item:hover,
    .gemini-command-item.selected {
      background: #f1f3f4;
    }

    .gemini-command-item.selected {
      background: #e8f0fe;
      border-left: 3px solid #1a73e8;
    }

    .gemini-command-icon {
      font-size: 16px;
      width: 20px;
      text-align: center;
    }

    .gemini-command-content {
      flex: 1;
    }

    .gemini-command-title {
      font-size: 14px;
      font-weight: 500;
      color: #202124;
      margin: 0 0 2px 0;
    }

    .gemini-command-description {
      font-size: 12px;
      color: #5f6368;
      margin: 0;
    }

    .gemini-command-shortcut {
      font-size: 11px;
      color: #5f6368;
      background: #f8f9fa;
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid #dadce0;
    }

    @media (prefers-color-scheme: dark) {
      .gemini-command-palette {
        background: #202124;
        color: #e8eaed;
      }

      .gemini-command-palette-header {
        background: #303134;
        border-bottom-color: #3c4043;
      }

      .gemini-command-palette-title {
        color: #e8eaed;
      }

      .gemini-command-palette-shortcuts {
        color: #9aa0a6;
      }

      .gemini-command-item:hover,
      .gemini-command-item.selected {
        background: #303134;
      }

      .gemini-command-item.selected {
        background: #1e3a8a;
        border-left-color: #4285f4;
      }

      .gemini-command-title {
        color: #e8eaed;
      }

      .gemini-command-description {
        color: #9aa0a6;
      }

      .gemini-command-shortcut {
        background: #303134;
        border-color: #5f6368;
        color: #9aa0a6;
      }
    }
  `);

  function createPalette() {
    if (paletteElement) return paletteElement;

    // Create overlay
    const overlay = document.createElement("div");
    overlay.className = "gemini-command-palette-overlay";
    overlay.addEventListener("click", closePalette);

    // Create palette
    const palette = document.createElement("div");
    palette.className = "gemini-command-palette";

    // Header
    const header = document.createElement("div");
    header.className = "gemini-command-palette-header";

    const title = document.createElement("h3");
    title.className = "gemini-command-palette-title";
    title.textContent = "⌘ Command Palette";

    const shortcuts = document.createElement("div");
    shortcuts.className = "gemini-command-palette-shortcuts";
    shortcuts.textContent =
      "Use ↑↓ or Ctrl-P/Ctrl-N to navigate, Enter to select, Esc to close";

    header.appendChild(title);
    header.appendChild(shortcuts);

    // Command list
    const list = document.createElement("div");
    list.className = "gemini-command-palette-list";

    commands.forEach((command, index) => {
      const item = document.createElement("button");
      item.className = "gemini-command-item";
      item.dataset.index = index;
      item.addEventListener("click", () => executeCommand(command));

      const icon = document.createElement("span");
      icon.className = "gemini-command-icon";
      icon.textContent = command.icon;

      const content = document.createElement("div");
      content.className = "gemini-command-content";

      const itemTitle = document.createElement("div");
      itemTitle.className = "gemini-command-title";
      itemTitle.textContent = command.title;

      const description = document.createElement("div");
      description.className = "gemini-command-description";
      description.textContent = command.description;

      content.appendChild(itemTitle);
      content.appendChild(description);

      item.appendChild(icon);
      item.appendChild(content);

      list.appendChild(item);
    });

    palette.appendChild(header);
    palette.appendChild(list);

    overlay.appendChild(palette);
    paletteElement = overlay;

    return overlay;
  }

  function openPalette() {
    console.log("[Gemini Command Palette] Opening palette...");

    // Check if palette already exists in DOM
    const existingPalette = document.querySelector(
      ".gemini-command-palette-overlay"
    );
    if (existingPalette) {
      console.log(
        "[Gemini Command Palette] Found existing palette in DOM, removing it"
      );
      existingPalette.remove();
      isOpen = false;
      paletteElement = null;
    }

    if (isOpen) {
      console.log(
        "[Gemini Command Palette] State says palette is open, but forcing reset"
      );
      isOpen = false;
      paletteElement = null;
    }

    isOpen = true;
    selectedIndex = 0;

    const palette = createPalette();
    console.log("[Gemini Command Palette] Created palette element:", palette);
    document.body.appendChild(palette);
    console.log("[Gemini Command Palette] Appended palette to body");

    // Force a reflow to ensure the element is rendered
    palette.offsetHeight;

    updateSelection();

    // Focus the palette for keyboard events
    palette.focus();
    console.log("[Gemini Command Palette] Palette opened successfully");

    // Debug: Check if element is actually visible
    const rect = palette.getBoundingClientRect();
    console.log("[Gemini Command Palette] Palette position and size:", rect);
    console.log(
      "[Gemini Command Palette] Palette computed style visibility:",
      window.getComputedStyle(palette).visibility
    );
    console.log(
      "[Gemini Command Palette] Palette computed style display:",
      window.getComputedStyle(palette).display
    );
  }

  function closePalette() {
    if (!isOpen) return;

    isOpen = false;
    if (paletteElement && paletteElement.parentNode) {
      paletteElement.parentNode.removeChild(paletteElement);
    }
  }

  function updateSelection() {
    if (!paletteElement) return;

    const items = paletteElement.querySelectorAll(".gemini-command-item");
    items.forEach((item, index) => {
      item.classList.toggle("selected", index === selectedIndex);
    });
  }

  function executeCommand(command) {
    closePalette();
    command.action();
  }

  function executeSelectedCommand() {
    if (selectedIndex >= 0 && selectedIndex < commands.length) {
      executeCommand(commands[selectedIndex]);
    }
  }

  function startNewChat() {
    console.log("[Gemini Command Palette] Starting new chat...");

    // Method 1: Look for "New chat" button with various selectors
    const selectors = [
      '[data-test-id="new-chat-button"]',
      '[aria-label="New chat"]',
      'button[aria-label*="New chat"]',
      '[arialabel="New chat"]',
      'side-nav-action-button[arialabel="New chat"]',
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button) {
        console.log(
          "[Gemini Command Palette] Found new chat button:",
          selector
        );

        // Check if button is disabled
        if (button.disabled || button.hasAttribute("disabled")) {
          console.log(
            "[Gemini Command Palette] Button is disabled, trying to enable it..."
          );
          // Try to enable it
          button.disabled = false;
          button.removeAttribute("disabled");

          // Also try to find and enable nested buttons
          const nestedButton = button.querySelector("button");
          if (nestedButton) {
            nestedButton.disabled = false;
            nestedButton.removeAttribute("disabled");
          }
        }

        // Try clicking the button
        button.click();

        // Also try triggering click on nested button if exists
        const nestedButton = button.querySelector("button");
        if (nestedButton) {
          nestedButton.click();
        }

        console.log("[Gemini Command Palette] Clicked new chat button");
        return;
      }
    }

    console.log(
      "[Gemini Command Palette] No new chat button found, trying navigation method"
    );

    // Method 2: Try to navigate to the base URL to start fresh
    if (window.location.pathname !== "/app") {
      console.log("[Gemini Command Palette] Navigating to /app");
      window.location.href = "https://gemini.google.com/app";
      return;
    }

    // Method 3: Try to clear current conversation by navigating to app root
    console.log("[Gemini Command Palette] Trying to start fresh conversation");
    window.location.href = "https://gemini.google.com/app";
  }

  function changeModel() {
    console.log("[Gemini Command Palette] Changing model...");

    // Method 1: Look for model selector/dropdown button
    const selectors = [
      '[data-test-id="model-selector"]',
      '[aria-label*="model"]',
      '[aria-label*="Model"]',
      'button[aria-label*="model"]',
      'button[aria-label*="Model"]',
      ".model-selector",
      '[role="button"][aria-label*="Gemini"]',
      "button[aria-expanded]", // Dropdown buttons
      '[data-test-id="conversation-model-switcher-button"]',
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button) {
        console.log(
          "[Gemini Command Palette] Found model selector button:",
          selector
        );
        button.click();
        console.log("[Gemini Command Palette] Clicked model selector");
        return;
      }
    }

    // Method 2: Look for any button/element containing "Gemini" text
    const elements = document.querySelectorAll('button, [role="button"]');
    for (const element of elements) {
      const text = element.textContent || element.innerText || "";
      if (text.includes("Gemini") || text.includes("model")) {
        console.log(
          "[Gemini Command Palette] Found potential model button with text:",
          text
        );
        element.click();
        console.log("[Gemini Command Palette] Clicked model button");
        return;
      }
    }

    // Method 3: Look for settings or preferences that might contain model selection
    const settingsSelectors = [
      '[aria-label*="Settings"]',
      '[aria-label*="settings"]',
      'button[aria-label*="Settings"]',
      ".settings-button",
      '[data-test-id="settings"]',
    ];

    for (const selector of settingsSelectors) {
      const button = document.querySelector(selector);
      if (button) {
        console.log(
          "[Gemini Command Palette] Found settings button, opening:",
          selector
        );
        button.click();
        console.log(
          "[Gemini Command Palette] Opened settings for model selection"
        );
        return;
      }
    }

    console.log(
      "[Gemini Command Palette] No model selector found. The model selection UI might not be available or uses different selectors."
    );

    // Show a helpful message to the user
    alert(
      "Model selector not found. Try looking for a model/settings button in the Gemini interface."
    );
  }

  function deleteCurrentChat() {
    console.log("[Gemini Command Palette] Deleting current chat...");

    // Method 1: Look for existing delete button if menu is already open
    const existingDeleteButton = document.querySelector(
      '[data-test-id="delete-button"]'
    );
    if (existingDeleteButton) {
      console.log(
        "[Gemini Command Palette] Found existing delete button in open menu"
      );
      existingDeleteButton.click();
      console.log("[Gemini Command Palette] Clicked delete button");
      return;
    }

    // Method 2: Look for the conversation actions menu button (three dots) for current conversation
    console.log(
      "[Gemini Command Palette] Looking for conversation actions menu button..."
    );

    // First, try to find the selected conversation (current chat)
    const selectedConversation = document.querySelector(
      ".conversation.selected"
    );
    if (selectedConversation) {
      console.log("[Gemini Command Palette] Found selected conversation");

      // Look for the actions menu button within the selected conversation's container
      const conversationContainer = selectedConversation.closest(
        ".conversation-items-container"
      );
      if (conversationContainer) {
        const actionsButton = conversationContainer.querySelector(
          '[data-test-id="actions-menu-button"]'
        );
        if (actionsButton) {
          console.log(
            "[Gemini Command Palette] Found actions menu button for selected conversation"
          );
          actionsButton.click();

          // Wait for menu to appear and click delete
          setTimeout(() => {
            const deleteButton = document.querySelector(
              '[data-test-id="delete-button"]'
            );
            if (deleteButton) {
              console.log(
                "[Gemini Command Palette] Found delete button in menu"
              );
              deleteButton.click();
              console.log("[Gemini Command Palette] Clicked delete button");
            } else {
              console.log(
                "[Gemini Command Palette] Delete button not found in menu"
              );
            }
          }, 150);
          return;
        }
      }
    }

    // Method 3: Look for any visible actions menu button
    console.log(
      "[Gemini Command Palette] Looking for any actions menu button..."
    );
    const actionsButtons = document.querySelectorAll(
      '[data-test-id="actions-menu-button"]'
    );
    for (const button of actionsButtons) {
      const rect = button.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        console.log(
          "[Gemini Command Palette] Found visible actions menu button"
        );
        button.click();

        setTimeout(() => {
          const deleteButton = document.querySelector(
            '[data-test-id="delete-button"]'
          );
          if (deleteButton) {
            console.log("[Gemini Command Palette] Found delete button in menu");
            deleteButton.click();
            console.log("[Gemini Command Palette] Clicked delete button");
          }
        }, 150);
        return;
      }
    }

    // Method 4: Look for menu buttons with aria-label containing menu/options
    console.log("[Gemini Command Palette] Looking for menu buttons...");
    const menuSelectors = [
      'button[aria-label*="menu"]',
      'button[aria-label*="Menu"]',
      'button[aria-label*="options"]',
      'button[aria-label*="Options"]',
      'button[aria-label*="More"]',
      'button[aria-label*="more"]',
      ".conversation-actions-menu-button",
      '[aria-haspopup="menu"]',
    ];

    for (const selector of menuSelectors) {
      const button = document.querySelector(selector);
      if (button) {
        const rect = button.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          console.log("[Gemini Command Palette] Found menu button:", selector);
          button.click();

          setTimeout(() => {
            const deleteButton = document.querySelector(
              '[data-test-id="delete-button"]'
            );
            if (deleteButton) {
              console.log(
                "[Gemini Command Palette] Found delete option in menu"
              );
              deleteButton.click();
              console.log("[Gemini Command Palette] Clicked delete button");
            }
          }, 150);
          return;
        }
      }
    }

    // Method 5: Try keyboard shortcut for delete
    console.log("[Gemini Command Palette] Trying delete keyboard shortcut...");
    const deleteEvent = new KeyboardEvent("keydown", {
      key: "Delete",
      code: "Delete",
      keyCode: 46,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(deleteEvent);

    // Also try Backspace
    const backspaceEvent = new KeyboardEvent("keydown", {
      key: "Backspace",
      code: "Backspace",
      keyCode: 8,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(backspaceEvent);

    // Method 6: As fallback, start a new chat (effectively "clearing" current one)
    setTimeout(() => {
      console.log(
        "[Gemini Command Palette] No delete method worked, starting new chat as alternative..."
      );
      startNewChat();
    }, 300);
  }

  function startNewTempChat() {
    console.log("[Gemini Command Palette] Starting new temporary chat...");
    const tempChatButton = document.querySelector(
      '[data-test-id="temp-chat-button"]'
    );
    if (tempChatButton) {
      console.log(
        "[Gemini Command Palette] Found temporary chat button:",
        tempChatButton
      );
      tempChatButton.click();
      console.log("[Gemini Command Palette] Clicked temporary chat button");
    } else {
      console.log("[Gemini Command Palette] No temporary chat button found.");
      alert(
        "Could not find the 'Temporary chat' button. The UI might have changed."
      );
    }
  }

  // Keyboard event handler
  function handleKeyDown(event) {
    console.log("[Gemini Command Palette] Key pressed:", {
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      code: event.code,
    });

    // Open palette with Ctrl/Cmd + K
    if ((event.ctrlKey || event.metaKey) && event.key === "k") {
      console.log(
        "[Gemini Command Palette] Cmd/Ctrl+K detected, opening palette"
      );
      event.preventDefault();
      event.stopPropagation();
      openPalette();
      return;
    }

    // Handle palette navigation
    if (!isOpen) return;

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        closePalette();
        break;

      case "ArrowDown":
      case "n": // Ctrl-N for next (Emacs style)
        if (event.key === "n" && !event.ctrlKey) break; // Only handle Ctrl-N, not plain 'n'
        event.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, commands.length - 1);
        updateSelection();
        break;

      case "ArrowUp":
      case "p": // Ctrl-P for previous (Emacs style)
        if (event.key === "p" && !event.ctrlKey) break; // Only handle Ctrl-P, not plain 'p'
        event.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        updateSelection();
        break;

      case "Enter":
        event.preventDefault();
        executeSelectedCommand();
        break;
    }
  }

  // Initialize
  function init() {
    console.log("[Gemini Command Palette] Initializing...");
    document.addEventListener("keydown", handleKeyDown, true); // Use capture phase
    console.log("[Gemini Command Palette] Added keydown event listener");

    // Add visual indicator that command palette is available
    console.log("[Gemini Command Palette] Loaded! Press Ctrl/Cmd + K to open.");

    // Test keyboard detection
    setTimeout(() => {
      console.log("[Gemini Command Palette] Ready for keyboard input");
    }, 1000);
  }

  // Expose functions for debugging
  window.geminiCommandPalette = {
    openPalette,
    startNewChat,
    isOpen: () => isOpen,
    reset: () => {
      console.log("[Gemini Command Palette] Resetting state...");
      isOpen = false;
      paletteElement = null;
      // Remove any existing palettes
      const existing = document.querySelectorAll(
        ".gemini-command-palette-overlay"
      );
      existing.forEach((el) => el.remove());
      console.log("[Gemini Command Palette] State reset complete");
    },
    test: () => {
      console.log("[Gemini Command Palette] Test function called");
      openPalette();
    },
    debug: () => {
      console.log("[Gemini Command Palette] Debug info:", {
        isOpen,
        paletteElement,
        existingElements: document.querySelectorAll(
          ".gemini-command-palette-overlay"
        ).length,
      });
    },
  };

  // Wait for page to load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
