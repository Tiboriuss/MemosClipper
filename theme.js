function applyTheme() {
    chrome.storage.sync.get(['theme'], (result) => {
        const theme = result.theme || 'auto';
        const root = document.documentElement;

        root.classList.remove('theme-light', 'theme-dark');

        if (theme === 'light') {
            root.classList.add('theme-light');
        } else if (theme === 'dark') {
            root.classList.add('theme-dark');
        }
    });
}

// Apply immediately on script load
applyTheme();

// Also listen for changes in storage to update theme in real-time if multiple pages are open
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.theme) {
        applyTheme();
    }
});
