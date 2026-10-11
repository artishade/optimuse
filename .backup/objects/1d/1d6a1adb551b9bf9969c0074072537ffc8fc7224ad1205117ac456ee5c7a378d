/**
 * Optimuse Web Client — chat UI with settings management, live tool visualization, and preview rendering.
 * API key and settings are managed via the server's encrypted vault.
 * Frontend also caches settings in localStorage for convenience.
 */

class OptimuseWebClient {
  chatContainer;
  previewContainer;
  messageInput;
  sendBtn;
  connectorBar;
  settingsModal;
  settingsBtn;
  closeSettingsBtn;
  saveSettingsBtn;

  apiKeyInput;
  baseUrlInput;
  modelInput;
  workspaceInput;
  permissionSelect;

  sessionId = 'web-' + Math.random().toString(36).slice(2, 10);
  isWaiting = false;
  hasApiKey = false;

  constructor() {
    this.chatContainer = document.getElementById('chat-container');
    this.previewContainer = document.getElementById('preview-container');
    this.messageInput = document.getElementById('message-input');
    this.sendBtn = document.getElementById('send-btn');
    this.connectorBar = document.getElementById('connector-bar');
    this.settingsModal = document.getElementById('settings-modal');
    this.settingsBtn = document.getElementById('settings-btn');
    this.closeSettingsBtn = document.getElementById('close-settings');
    this.saveSettingsBtn = document.getElementById('save-settings');

    this.apiKeyInput = document.getElementById('api-key');
    this.baseUrlInput = document.getElementById('base-url');
    this.modelInput = document.getElementById('model-name');
    this.workspaceInput = document.getElementById('workspace-path');
    this.permissionSelect = document.getElementById('permission-mode');

    this.bindEvents();
    this.loadHealth();
    this.loadSettings();
    this.loadConnectors();
  }

  bindEvents() {
    this.sendBtn.addEventListener('click', () => this.sendMessage());

    this.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!this.isWaiting && this.hasApiKey) this.sendMessage();
      }
    });

    this.messageInput.addEventListener('input', () => {
      this.messageInput.style.height = 'auto';
      this.messageInput.style.height = Math.min(this.messageInput.scrollHeight, 120) + 'px';
    });

    this.settingsBtn.addEventListener('click', () => this.openSettings());
    this.closeSettingsBtn.addEventListener('click', () => this.closeSettings());
    this.saveSettingsBtn.addEventListener('click', () => this.saveSettings());

    this.settingsModal.addEventListener('click', (e) => {
      if (e.target === this.settingsModal) this.closeSettings();
    });
  }

  // --- Health ---

  async loadHealth() {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      this.hasApiKey = data.hasApiKey;
      this.sendBtn.disabled = !this.hasApiKey;
      if (!this.hasApiKey) {
        setTimeout(() => this.openSettings(), 300);
      }
    } catch (e) {
      console.error('health check failed', e);
    }
  }

  // --- Settings ---

  async loadSettings() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();

      // Fill form with server settings (apiKey is masked)
      if (data.apiKey && data.apiKey.startsWith('••')) {
        // Don't try to restore masked key — leave placeholder
        this.apiKeyInput.value = '';
        this.apiKeyInput.placeholder = data.apiKey;
      } else if (data.apiKey) {
        this.apiKeyInput.value = data.apiKey;
      }
      this.baseUrlInput.value = data.baseUrl || 'https://api.openai.com/v1';
      this.modelInput.value = data.model || '';
      this.workspaceInput.value = data.workspace || '/root/optimuse';
      this.permissionSelect.value = data.mode || 'workspace';

      this.hasApiKey = !!data.apiKey;
      this.sendBtn.disabled = !this.hasApiKey;
    } catch (e) {
      console.error('settings load failed', e);
    }
  }

  openSettings() {
    this.settingsModal.classList.add('visible');
    // Mask existing key for display
    if (this.apiKeyInput.value) {
      this.apiKeyInput.dataset.original = this.apiKeyInput.value;
      this.apiKeyInput.value = '••••••••••••••••' + this.apiKeyInput.value.slice(-4);
    }
  }

  closeSettings() {
    this.settingsModal.classList.remove('visible');
    // Restore original key if user didn't change it
    if (this.apiKeyInput.dataset.original) {
      this.apiKeyInput.value = this.apiKeyInput.dataset.original;
      delete this.apiKeyInput.dataset.original;
    }
    // Clear placeholder masking
    this.apiKeyInput.placeholder = '';
  }

  async saveSettings() {
    const apiKey = this.apiKeyInput.value.replace('••••••••••••••••', '').trim();
    const baseUrl = this.baseUrlInput.value.trim();
    const model = this.modelInput.value.trim();
    const workspace = this.workspaceInput.value.trim();
    const mode = this.permissionSelect.value;

    const payload = { apiKey, baseUrl, model, workspace, mode };

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.ok) {
        this.hasApiKey = !!apiKey;
        this.sendBtn.disabled = !this.hasApiKey;
        this.closeSettings();
        this.updateMeta();
        this.showNotification('Settings saved successfully ✅');
      } else {
        this.showNotification('Failed to save settings ❌');
      }
    } catch (e) {
      this.showNotification(`Error: ${(e instanceof Error).message}`);
    }
  }

  showNotification(msg) {
    const el = document.createElement('div');
    el.className = 'notification';
    el.textContent = msg;
    el.style.cssText = `
      position: fixed; top: 16px; right: 16px; padding: 10px 16px;
      background: rgba(17, 17, 25, 0.9); border: 1px solid var(--border);
      border-radius: 8px; font-size: 13px; z-index: 200;
      color: var(--text);
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  updateMeta() {
    const meta = document.getElementById('model-meta');
    meta.textContent = `model: ${this.modelInput.value || 'default'} · mode: ${this.permissionSelect.value}`;
  }

  // --- Connectors ---

  async loadConnectors() {
    try {
      const res = await fetch('/api/connectors');
      const connectors = await res.json();
      this.connectorBar.innerHTML = '';
      for (const c of connectors) {
        const pill = document.createElement('span');
        pill.className = `connector-pill${c.connected ? ' connected' : ''}`;
        pill.textContent = `${c.id} ${c.connected ? '🔗' : '⚪'}`;
        this.connectorBar.appendChild(pill);
      }
      if (connectors.length === 0) {
        this.connectorBar.innerHTML = '<span class="connector-pill" style="color: var(--text-muted);">No connectors available</span>';
      }
    } catch (e) {
      console.error('connector load failed', e);
    }
  }

  // --- Chat ---

  async sendMessage() {
    const text = this.messageInput.value.trim();
    if (!text || this.isWaiting) return;

    this.isWaiting = true;
    this.sendBtn.disabled = true;
    this.messageInput.value = '';
    this.messageInput.style.height = 'auto';

    this.addMessage('user', text);
    const thinkingEl = this.addThinking();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId: this.sessionId }),
      });
      const data = await res.json();

      thinkingEl.remove();

      if (data.error) {
        this.addMessage('assistant', `❌ Error: ${data.error}`);
        return;
      }

      this.addMessage('assistant', data.finalText || '(no response)');
      this.renderPreview(data);

    } catch (e) {
      thinkingEl.remove();
      this.addMessage('assistant', `❌ Network error: ${(e instanceof Error).message}`);
    } finally {
      this.isWaiting = false;
      this.sendBtn.disabled = !this.hasApiKey;
      this.messageInput.focus();
    }
  }

  addMessage(role, text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message message-${role}`;
    msgDiv.textContent = text;
    this.chatContainer.appendChild(msgDiv);
    this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    return msgDiv;
  }

  addThinking() {
    const div = document.createElement('div');
    div.className = 'thinking';
    div.innerHTML = `<span>Thinking...</span><div class="thinking-dots"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></div>`;
    this.chatContainer.appendChild(div);
    this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    return div;
  }

  renderPreview(data) {
    const { finalText, toolResults = [], toolCalls = [] } = data;

    if (toolResults.length === 0 && !finalText) {
      this.previewContainer.innerHTML = '<div class="preview-placeholder">📺 No preview available</div>';
      return;
    }

    let html = '';

    if (toolCalls.length > 0) {
      html += '<div class="preview-section"><h3 style="color: var(--text-muted); font-size: 12px; margin-bottom: 8px;">Tool Calls</h3>';
      for (const tc of toolCalls) {
        html += `<div style="padding: 8px; margin-bottom: 8px; background: rgba(59, 130, 246, 0.1); border-radius: 6px; border-left: 3px solid var(--tool-read);">`;
        html += `<div style="font-size: 11px; font-weight: 600; color: var(--tool-read);">${this.escapeHtml(tc.name)}</div>`;
        html += `<pre style="font-family: monospace; font-size: 11px; color: var(--text-muted); margin-top: 4px; white-space: pre-wrap;">${this.escapeHtml(JSON.stringify(tc.arguments, null, 2))}</pre>`;
        html += `</div>`;
      }
      html += '</div>';
    }

    if (toolResults.length > 0) {
      html += '<div class="preview-section"><h3 style="color: var(--text-muted); font-size: 12px; margin-bottom: 8px;">Tool Results</h3>';
      for (const tr of toolResults) {
        const statusColor = tr.ok ? 'var(--success)' : 'var(--error)';
        const statusText = tr.ok ? '✔' : '✘';
        html += `<div style="padding: 8px; margin-bottom: 8px; background: rgba(255,255,255,0.02); border-radius: 6px; border-left: 3px solid ${statusColor};">`;
        html += `<div style="font-size: 11px; font-weight: 600; color: ${statusColor}; margin-bottom: 4px;">${statusText} ${this.escapeHtml(tr.toolName || 'tool')}</div>`;
        html += `<pre style="font-family: monospace; font-size: 11px; color: var(--text-muted); white-space: pre-wrap; max-height: 200px; overflow-y: auto;">${this.escapeHtml(tr.content || (tr.error || '(empty)'))}</pre>`;
        html += `</div>`;
      }
      html += '</div>';
    }

    if (finalText) {
      html += '<div class="preview-section"><h3 style="color: var(--text-muted); font-size: 12px; margin-bottom: 8px;">Response</h3>';
      html += `<div style="font-size: 13px; line-height: 1.6; color: var(--text);">${this.escapeHtml(finalText)}</div>`;
      html += '</div>';
    }

    this.previewContainer.innerHTML = html;
  }

  escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new OptimuseWebClient();
});