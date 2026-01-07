document.addEventListener('DOMContentLoaded', async () => {
    const titleEl = document.getElementById('tab-title');
    const commentEl = document.getElementById('comment');
    const visibilitySelect = document.getElementById('visibility-select');
    const sendBtn = document.getElementById('send-btn');
    const statusEl = document.getElementById('status');
    const settingsLink = document.getElementById('open-settings');

    let currentTab = null;
    let selectedText = "";

    // Get current tab info and selected text
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        currentTab = tabs[0];
        titleEl.textContent = currentTab.title;

        const result = await chrome.scripting.executeScript({
            target: { tabId: currentTab.id },
            func: () => window.getSelection().toString()
        });

        if (result && result[0] && result[0].result) {
            selectedText = result[0].result;
        }
    } catch (error) {
        titleEl.textContent = 'Error loading tab info';
        sendBtn.disabled = true;
    }

    // Load settings
    const settings = await chrome.storage.sync.get(['memosUrl', 'accessToken', 'defaultTags', 'template', 'visibility']);
    if (settings.visibility) {
        visibilitySelect.value = settings.visibility;
    }

    settingsLink.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
    });

    sendBtn.addEventListener('click', async () => {
        if (!settings.memosUrl || !settings.accessToken) {
            statusEl.textContent = 'Please configure settings first.';
            statusEl.style.color = 'var(--error)';
            return;
        }

        const screenshotType = document.querySelector('input[name="screenshot-type"]:checked').value;
        const template = settings.template || "### {title}\n{selection}\n\nSource: {url}\n{tags}";
        const commentText = commentEl.value.trim();
        const finalSelection = selectedText || commentText;

        let content = template
            .replace(/{title}/g, currentTab.title || "Untitled")
            .replace(/{url}/g, currentTab.url || "")
            .replace(/{selection}/g, finalSelection || "(No content selected)")
            .replace(/{tags}/g, settings.defaultTags || "")
            .trim();

        if (selectedText && commentText) {
            content += `\n\nComment: ${commentText}`;
        }

        const memoBody = {
            content: content,
            visibility: visibilitySelect.value
        };

        // If it's a simple memo without area selection, we could do it here or via background.
        // To keep logic consistent and use the Toast, let's offload EVERYTHING to background if it's not "none" or just always.
        // Actually, let's offload everything to background to ensure the Toast logic works consistently.

        chrome.runtime.sendMessage({
            type: 'start-area-capture',
            data: {
                tabId: currentTab.id,
                windowId: currentTab.windowId,
                memoBody: memoBody,
                settings: settings,
                screenshotType: screenshotType
            }
        });

        statusEl.textContent = 'Redirecting to page...';
        statusEl.style.color = 'var(--success)';
        setTimeout(() => window.close(), 500);
    });
});
