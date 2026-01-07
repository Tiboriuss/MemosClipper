// Register context menus on installation
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "clip-page",
        title: "Clip Page to Memos",
        contexts: ["page"]
    });

    chrome.contextMenus.create({
        id: "clip-selection",
        title: "Clip Selection to Memos",
        contexts: ["selection"]
    });
});

// Helper for Toast
async function showToast(tabId, message, isError = false) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: (msg, err) => {
                window.memosToastMessage = msg;
                window.memosToastIsError = err;
            },
            args: [message, isError]
        });
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['toast.js']
        });
    } catch (e) {
        console.error("Toast failed", e);
    }
}

async function uploadAttachment(memosUrl, token, memoName, base64Content) {
    const response = await fetch(`${memosUrl}/api/v1/attachments`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            filename: 'screenshot.png',
            content: base64Content,
            type: 'image/png',
            memo: memoName
        })
    });
    return response.ok;
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    const settings = await chrome.storage.sync.get(['memosUrl', 'accessToken', 'defaultTags', 'template', 'visibility']);

    if (!settings.memosUrl || !settings.accessToken) {
        return;
    }

    const template = settings.template || "### {title}\n{selection}\n\nSource: {url}\n{tags}";
    const content = template
        .replace(/{title}/g, tab.title)
        .replace(/{url}/g, tab.url)
        .replace(/{selection}/g, info.selectionText || "")
        .replace(/{tags}/g, settings.defaultTags || "")
        .trim();

    try {
        const response = await fetch(`${settings.memosUrl}/api/v1/memos`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.accessToken}`
            },
            body: JSON.stringify({
                content: content,
                visibility: settings.visibility || "PRIVATE"
            })
        });

        if (response.ok) {
            showToast(tab.id, "Memo saved!");
        } else {
            showToast(tab.id, "Failed to save memo", true);
        }
    } catch (error) {
        showToast(tab.id, "Network error", true);
    }
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'start-area-capture') {
        handleAreaCapture(message.data);
    }
    return true;
});

async function handleAreaCapture(data) {
    const { tabId, windowId, memoBody, settings, screenshotType } = data;

    try {
        let base64Content = null;

        if (screenshotType === 'area') {
            // 1. Inject selector
            const results = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['selector.js']
            });

            const rect = results[0].result;
            if (rect && rect.width > 0 && rect.height > 0) {
                // 2. Capture and Crop
                const fullDataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
                base64Content = await cropImageInBackground(tabId, fullDataUrl, rect);
            }
        } else if (screenshotType === 'full') {
            const fullDataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
            base64Content = fullDataUrl.split(',')[1];
        }

        // 3. Create Memo
        const response = await fetch(`${settings.memosUrl}/api/v1/memos`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.accessToken}`
            },
            body: JSON.stringify(memoBody)
        });

        if (!response.ok) throw new Error("Memo creation failed");
        const createdMemo = await response.json();

        // 4. Upload Screenshot if we have one
        if (base64Content) {
            await uploadAttachment(settings.memosUrl, settings.accessToken, createdMemo.name, base64Content);
        }

        showToast(tabId, "Memo saved successfully!");
    } catch (err) {
        console.error(err);
        showToast(tabId, "Error: " + err.message, true);
    }
}

// Background crop helper (using Offscreen Canvas if available, or just a dummy element in a hidden tab)
// For MV3, we can't easily use Canvas in background, but we can use an Offscreen Document or 
// just inject a cropping script into the tab we just captured.
// Let's inject a cropping script into the tab as it's easier than setting up offscreen.
async function cropImageInBackground(tabId, dataUrl, rect) {
    const results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: async (url, r) => {
            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    const dpr = r.devicePixelRatio || 1;
                    const canvas = document.createElement('canvas');
                    canvas.width = r.width * dpr;
                    canvas.height = r.height * dpr;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, r.x * dpr, r.y * dpr, r.width * dpr, r.height * dpr, 0, 0, r.width * dpr, r.height * dpr);
                    resolve(canvas.toDataURL('image/png').split(',')[1]);
                };
                img.src = url;
            });
        },
        args: [dataUrl, rect]
    });
    return results[0].result;
}
