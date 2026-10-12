class SiteHeader extends HTMLElement {
  connectedCallback() {
    const active = this.getAttribute('active');
    const toolkitHref = active === 'home' ? '#toolkit' : '/#toolkit';
    const aboutHref = active === 'home' ? '#about' : '/#about';
    this.innerHTML = `<header class="site-header"><a class="brand" href="/" aria-label="Handoo Labs home"><span class="brand-mark">h<span>.</span></span><span class="brand-wordmark">handoo<span>labs</span></span></a><nav class="main-nav" aria-label="Main navigation"><a ${active === 'home' ? 'aria-current="page"' : ''} href="${toolkitHref}">Toolkit</a><a href="https://github.com/DipanshuHandoo" target="_blank" rel="noreferrer">GitHub <span aria-hidden="true">↗</span></a><a href="${aboutHref}">About</a></nav><div class="header-actions"><span class="header-status"><span class="status-dot"></span> ALWAYS EXPERIMENTING</span><button type="button" class="theme-toggle" data-theme-button aria-label="Switch to light mode"><span class="theme-icon" aria-hidden="true">◐</span></button><a class="button button-small" href="${toolkitHref}">Explore tools <span aria-hidden="true">↗</span></a></div></header>`;
    const theme = document.documentElement.dataset.theme;
    const themeButton = this.querySelector('[data-theme-button]');
    themeButton.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
    themeButton.addEventListener('click', () => window.handooTheme.toggle());
  }
}

class SiteFooter extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `<footer class="site-footer page-wrap"><a class="brand" href="/"><span class="brand-mark">h<span>.</span></span><span class="brand-wordmark">handoo<span>labs</span></span></a><span>Made with curiosity, not a framework.</span><span>© ${new Date().getFullYear()} Handoo Labs</span></footer>`;
  }
}

customElements.define('site-header', SiteHeader);
customElements.define('site-footer', SiteFooter);
