const PAGE_URL_PATTERNS = ["http://*/*", "https://*/*"];

// Register context menus on installation
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
        id: "clip-page",
        title: "Clip Page to Memos",
        contexts: ["page"],
        documentUrlPatterns: PAGE_URL_PATTERNS
    });

    chrome.contextMenus.create({
        id: "clip-selection",
        title: "Clip Selection to Memos",
        contexts: ["selection"],
        documentUrlPatterns: PAGE_URL_PATTERNS
    });

    chrome.contextMenus.create({
        id: "clip-image",
        title: "Clip Image to Memos",
        contexts: ["image"],
        documentUrlPatterns: PAGE_URL_PATTERNS
    });

    chrome.contextMenus.create({
        id: "clip-link",
        title: "Clip Link to Memos",
        contexts: ["link"],
        documentUrlPatterns: PAGE_URL_PATTERNS
    });
    }); // end removeAll callback
});

const MENU_ITEM_IDS = ["clip-page", "clip-selection", "clip-image", "clip-link"];

function setMenuVisibility(visible) {
    for (const id of MENU_ITEM_IDS) {
        chrome.contextMenus.update(id, { visible });
    }
}

function isWebUrl(url) {
    return !!(url && (url.startsWith('http://') || url.startsWith('https://')));
}

// Hide items on non-web tabs (chrome://, new tab, etc.) so they don't appear
// in the extension icon right-click menu. Show them on real web pages.
chrome.tabs.onActivated.addListener(({ tabId }) => {
    chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) return;
        setMenuVisibility(isWebUrl(tab?.url));
    });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url !== undefined && tab.active) {
        setMenuVisibility(isWebUrl(changeInfo.url));
    }
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

async function uploadAttachment(memosUrl, token, memoName, base64Content, filename = 'screenshot.png', contentType = 'image/png') {
    const response = await fetch(`${memosUrl}/api/v1/attachments`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            filename: filename,
            content: base64Content,
            type: contentType,
            memo: memoName
        })
    });
    return response.ok;
}

function buildMemoContent(template, tab, selectionText, tags) {
    return template
        .replace(/{title}/g, tab?.title || "")
        .replace(/{url}/g, tab?.url || "")
        .replace(/{selection}/g, selectionText || "")
        .replace(/{tags}/g, tags || "")
        .trim();
}

async function createMemo(memosUrl, accessToken, content, visibility) {
    return fetch(`${memosUrl}/api/v1/memos`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
            content,
            visibility: visibility || "PRIVATE"
        })
    });
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';

    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
}

function inferExtensionFromType(contentType) {
    const map = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/svg+xml': 'svg',
        'image/bmp': 'bmp',
        'image/avif': 'avif'
    };

    return map[contentType?.toLowerCase()] || 'png';
}

function buildImageFilename(srcUrl, contentType) {
    try {
        const parsed = new URL(srcUrl);
        const rawName = parsed.pathname.split('/').pop();
        const cleanName = rawName ? rawName.split('?')[0] : '';

        if (cleanName && /\.[a-zA-Z0-9]{2,5}$/.test(cleanName)) {
            return cleanName;
        }
    } catch (_) {
        // Ignore URL parse issues and fall back to generated name.
    }

    return `clipped-image.${inferExtensionFromType(contentType)}`;
}

async function imageUrlToAttachmentPayload(srcUrl) {
    const response = await fetch(srcUrl);

    if (!response.ok) {
        throw new Error(`Image fetch failed (${response.status})`);
    }

    const blob = await response.blob();
    const contentType = blob.type || response.headers.get('content-type') || 'image/png';
    const buffer = await blob.arrayBuffer();

    return {
        base64Content: arrayBufferToBase64(buffer),
        contentType,
        filename: buildImageFilename(srcUrl, contentType)
    };
}

async function getLinkTextFromPage(tabId, linkUrl) {
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: (href) => {
                try {
                    const target = new URL(href).href;
                    for (const a of document.querySelectorAll('a')) {
                        try {
                            if (new URL(a.href).href === target) {
                                return a.textContent.trim() || null;
                            }
                        } catch (_) {}
                    }
                } catch (_) {}
                return null;
            },
            args: [linkUrl]
        });
        return results[0]?.result || null;
    } catch (_) {
        return null;
    }
}

async function handleLinkContextMenu(info, tab, settings) {
    if (!info.linkUrl) {
        showToast(tab.id, "No link URL found", true);
        return;
    }

    const template = settings.template || "### {title}\n{selection}\n\nSource: {url}\n{tags}";
    // Prefer DOM-scraped anchor text; fall back to info.linkText then the raw URL.
    const scraped = await getLinkTextFromPage(tab.id, info.linkUrl);
    const linkText = scraped || info.linkText || info.linkUrl;
    const content = template
        .replace(/{title}/g, tab?.title || "")
        .replace(/{url}/g, info.linkUrl)
        .replace(/{selection}/g, linkText)
        .replace(/{tags}/g, settings.defaultTags || "")
        .trim();

    try {
        const response = await createMemo(settings.memosUrl, settings.accessToken, content, settings.visibility);

        if (response.ok) {
            showToast(tab.id, "Link memo saved!");
        } else {
            showToast(tab.id, "Failed to save memo", true);
        }
    } catch (error) {
        showToast(tab.id, "Network error", true);
    }
}

async function handleImageContextMenu(info, tab, settings) {
    if (!info.srcUrl) {
        showToast(tab.id, "No image source found", true);
        return;
    }

    const template = settings.template || "### {title}\n{selection}\n\nSource: {url}\n{tags}";
    const content = buildMemoContent(template, tab, "", settings.defaultTags || "");

    try {
        const imagePayload = await imageUrlToAttachmentPayload(info.srcUrl);

        const memoResponse = await createMemo(
            settings.memosUrl,
            settings.accessToken,
            content,
            settings.visibility
        );

        if (!memoResponse.ok) {
            showToast(tab.id, "Failed to save memo", true);
            return;
        }

        const createdMemo = await memoResponse.json();
        const uploaded = await uploadAttachment(
            settings.memosUrl,
            settings.accessToken,
            createdMemo.name,
            imagePayload.base64Content,
            imagePayload.filename,
            imagePayload.contentType
        );

        if (!uploaded) {
            showToast(tab.id, "Image upload failed", true);
            return;
        }

        showToast(tab.id, "Image memo saved!");
    } catch (error) {
        console.error(error);
        showToast(tab.id, "Could not fetch image bytes from this site", true);
    }
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    // Ignore clicks from the extension icon right-click menu (no valid page tab)
    if (!tab?.url || !(tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        return;
    }

    const settings = await chrome.storage.sync.get(['memosUrl', 'accessToken', 'defaultTags', 'template', 'visibility']);

    if (!settings.memosUrl || !settings.accessToken) {
        return;
    }

    if (info.menuItemId === 'clip-image') {
        await handleImageContextMenu(info, tab, settings);
        return;
    }

    if (info.menuItemId === 'clip-link') {
        await handleLinkContextMenu(info, tab, settings);
        return;
    }

    const template = settings.template || "### {title}\n{selection}\n\nSource: {url}\n{tags}";
    const content = buildMemoContent(template, tab, info.selectionText || "", settings.defaultTags || "");

    try {
        const response = await createMemo(settings.memosUrl, settings.accessToken, content, settings.visibility);

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
