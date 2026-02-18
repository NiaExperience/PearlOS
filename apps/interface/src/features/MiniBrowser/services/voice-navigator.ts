export type VoiceAction = 'navigate' | 'click' | 'search' | 'scroll' | 'read' | 'find';

export interface VoiceCommand {
  action: VoiceAction;
  target?: string;
  params?: Record<string, unknown>;
}

export interface NavigationResult {
  success: boolean;
  action: VoiceAction;
  message: string;
  element?: string; // CSS selector if relevant
}

export class VoiceNavigator {
  constructor(private readonly scrapedData?: unknown) {}

  parseVoiceCommand(command: string): VoiceCommand {
    const text = (command || '').toLowerCase();
    if (/\bscroll\b/.test(text)) {
      const dir = /up/.test(text) ? 'up' : 'down';
      return { action: 'scroll', params: { direction: dir } };
    }
    if (/\bsearch\b/.test(text)) {
      const target = text.replace(/.*search\s+for\s+/, '').trim();
      return { action: 'search', target };
    }
    if (/\bclick\b/.test(text)) {
      const target = text.replace(/.*click\s+/, '').trim();
      return { action: 'click', target };
    }
    if (/\bread\b/.test(text)) {
      return { action: 'read' };
    }
    if (/\bnavigate\b/.test(text)) {
      const target = text.replace(/.*navigate\s+to\s+/, '').trim();
      return { action: 'navigate', target };
    }
    return { action: 'find', target: text };
  }

  async executeCommand(command: VoiceCommand): Promise<NavigationResult> {
    switch (command.action) {
      case 'click':
        return this.executeClick(command);
      case 'search':
        return this.executeSearch(command);
      case 'scroll':
        return this.executeScroll(command);
      case 'navigate':
        return { success: true, action: 'navigate', message: `Navigate to ${command.target}` };
      case 'read':
        return { success: true, action: 'read', message: 'Read current section' };
      case 'find':
      default:
        return { success: true, action: 'find', message: `Find ${command.target}` };
    }
  }

  private executeClick(command: VoiceCommand): NavigationResult {
    const target = (command.target || '').trim();
    if (!target) return { success: false, action: 'click', message: 'No click target provided' };
    return { success: true, action: 'click', message: `Click ${target}`, element: `button, a` };
  }

  private executeSearch(command: VoiceCommand): NavigationResult {
    const target = (command.target || '').trim();
    return { success: true, action: 'search', message: `Search for ${target}`, element: 'input[type="search"], input[type="text"], input[name*="q" i]' };
  }

  private executeScroll(command: VoiceCommand): NavigationResult {
    const direction = String(command.params?.direction || 'down');
    return { success: true, action: 'scroll', message: `Scroll ${direction}` };
  }
}

/**
 * Browser Script Templates
 * These are injectable JavaScript snippets for voice navigation actions
 */
const BrowserScripts = {
  click: (targetText: string, elementSelector: string) => `
    (() => {
      function queryByText(root, text) {
        text = (text || '').toLowerCase();
        const nodes = root.querySelectorAll('a, button, [role="button"], [onclick]');
        for (const el of nodes) {
          const t = (el.textContent || '').trim().toLowerCase();
          if (t.includes(text)) return el;
        }
        return null;
      }
      
      const targetText = ${JSON.stringify(targetText)};
      let el = document.querySelector(${JSON.stringify(elementSelector)});
      
      if (!el && targetText) {
        el = queryByText(document, targetText);
      }
      
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.outline = '2px solid #10b981';
        setTimeout(() => {
          el.click();
        }, 300);
        window.parent && window.parent.postMessage({
          type: 'ENHANCED_BROWSER_VOICE_ACTION',
          data: { success: true, action: 'click' }
        }, '*');
      } else {
        window.parent && window.parent.postMessage({
          type: 'ENHANCED_BROWSER_VOICE_ACTION',
          data: { success: false, action: 'click', message: 'Element not found' }
        }, '*');
      }
    })();
  `,

  search: (searchTerm: string) => `
    (() => {
      const term = ${JSON.stringify(searchTerm)};
      const input = document.querySelector('input[type="search"], input[name*="q" i], input[type="text"]');
      
      if (input) {
        input.focus();
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.value = term;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        
        const form = input.closest('form');
        const btn = document.querySelector('button[type="submit"], input[type="submit"]');
        
        if (btn) {
          btn.click();
        } else if (form) {
          form.submit();
        } else {
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }
        
        window.parent && window.parent.postMessage({
          type: 'ENHANCED_BROWSER_VOICE_ACTION',
          data: { success: true, action: 'search' }
        }, '*');
      } else {
        window.parent && window.parent.postMessage({
          type: 'ENHANCED_BROWSER_VOICE_ACTION',
          data: { success: false, action: 'search', message: 'Search field not found' }
        }, '*');
      }
    })();
  `,

  scroll: (direction: string) => `
    (() => {
      const dir = ${JSON.stringify(direction)};
      const by = dir === 'up' ? -400 : 400;
      
      window.scrollBy({ top: by, behavior: 'smooth' });
      
      window.parent && window.parent.postMessage({
        type: 'ENHANCED_BROWSER_VOICE_ACTION',
        data: { success: true, action: 'scroll' }
      }, '*');
    })();
  `,

  navigate: (linkText: string) => `
    (() => {
      const targetText = ${JSON.stringify(linkText)};
      const links = [...document.querySelectorAll('a')];
      const found = links.find(a => 
        (a.textContent || '').trim().toLowerCase().includes(String(targetText).toLowerCase())
      );
      
      if (found) {
        found.click();
        window.parent && window.parent.postMessage({
          type: 'ENHANCED_BROWSER_VOICE_ACTION',
          data: { success: true, action: 'navigate' }
        }, '*');
      } else {
        window.parent && window.parent.postMessage({
          type: 'ENHANCED_BROWSER_VOICE_ACTION',
          data: { success: false, action: 'navigate', message: 'Link not found' }
        }, '*');
      }
    })();
  `,

  read: () => `
    (() => {
      const sel = window.getSelection();
      const txt = sel && String(sel).trim();
      
      window.parent && window.parent.postMessage({
        type: 'ENHANCED_BROWSER_VOICE_ACTION',
        data: { success: true, action: 'read', text: txt || '' }
      }, '*');
    })();
  `,

  find: () => `
    (() => {
      window.parent && window.parent.postMessage({
        type: 'ENHANCED_BROWSER_VOICE_ACTION',
        data: { success: true, action: 'find' }
      }, '*');
    })();
  `
};

export function generateBrowserScript(result: NavigationResult, parsed: VoiceCommand): string {
  switch (result.action) {
    case 'click':
      return BrowserScripts.click(parsed.target || '', result.element || '');
    case 'search':
      return BrowserScripts.search(parsed.target || '');
    case 'scroll':
      return BrowserScripts.scroll(String(parsed.params?.direction || 'down'));
    case 'navigate':
      return BrowserScripts.navigate(parsed.target || '');
    case 'read':
      return BrowserScripts.read();
    default:
      return BrowserScripts.find();
  }
}


