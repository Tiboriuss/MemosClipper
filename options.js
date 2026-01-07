document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('memos-url');
  const tokenInput = document.getElementById('access-token');
  const tagsInput = document.getElementById('default-tags');
  const themeSelect = document.getElementById('theme-select');
  const visibilitySelect = document.getElementById('default-visibility');
  const templateInput = document.getElementById('content-template');
  const saveBtn = document.getElementById('save-btn');
  const status = document.getElementById('status');

  // Load existing settings
  chrome.storage.sync.get(['memosUrl', 'accessToken', 'defaultTags', 'theme', 'visibility', 'template'], (result) => {
    if (result.memosUrl) urlInput.value = result.memosUrl;
    if (result.accessToken) tokenInput.value = result.accessToken;
    if (result.defaultTags) tagsInput.value = result.defaultTags;
    if (result.theme) themeSelect.value = result.theme;
    if (result.visibility) visibilitySelect.value = result.visibility;
    if (result.template) templateInput.value = result.template;
  });

  // Save settings
  saveBtn.addEventListener('click', () => {
    const memosUrl = urlInput.value.trim().replace(/\/$/, "");
    const accessToken = tokenInput.value.trim();
    const defaultTags = tagsInput.value.trim();
    const theme = themeSelect.value;
    const visibility = visibilitySelect.value;
    const template = templateInput.value;

    chrome.storage.sync.set({
      memosUrl,
      accessToken,
      defaultTags,
      theme,
      visibility,
      template
    }, () => {
      status.textContent = 'Settings saved successfully!';
      status.style.color = 'var(--success)';
      setTimeout(() => {
        status.textContent = '';
      }, 2000);
    });
  });
});
