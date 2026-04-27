chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "REDOC_AUTOFILL_TOGGLE" });
  } catch (error) {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["content-styles.css"]
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content-script.js"]
    });

    await chrome.tabs.sendMessage(tab.id, { type: "REDOC_AUTOFILL_TOGGLE" });
  }
});
