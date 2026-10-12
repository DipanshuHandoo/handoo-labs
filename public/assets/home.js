const grid = document.querySelector('#tool-grid');
const search = document.querySelector('#tool-search');
const filterRoot = document.querySelector('#category-filters');
let tools = [];
let selectedCategory = 'All';

function render() {
  const query = search.value.trim().toLowerCase();
  const visible = tools.filter((tool) => (selectedCategory === 'All' || tool.category === selectedCategory)
    && `${tool.name} ${tool.package} ${tool.description} ${tool.features.join(' ')}`.toLowerCase().includes(query));
  grid.innerHTML = visible.length ? visible.map((tool) => `<article class="tool-card"><div class="tool-card-top"><span class="tool-icon ${escapeHtml(tool.color)}">${escapeHtml(tool.icon)}</span><span class="tool-category">${escapeHtml(tool.category)}</span></div><h3>${escapeHtml(tool.name)}</h3><p class="package-name">${escapeHtml(tool.package)}</p><p class="tool-description">${escapeHtml(tool.description)}</p><div class="feature-tags">${tool.features.slice(0, 3).map((feature) => `<span>${escapeHtml(feature)}</span>`).join('')}</div><div class="tool-card-links"><a class="tool-link" href="/${encodeURIComponent(tool.slug)}/">Open playground <span aria-hidden="true">↗</span></a><span><a href="${escapeHtml(tool.npm)}" target="_blank" rel="noreferrer">npm</a><a href="${escapeHtml(tool.repository)}" target="_blank" rel="noreferrer">source</a></span></div></article>`).join('') : '<div class="empty-state">No tools match that search. Try another keyword.</div>';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

async function load() {
  try {
    const response = await fetch('/api/tools');
    if (!response.ok) throw new Error(`Tool catalogue returned ${response.status}`);
    tools = await response.json();
    const categories = ['All', ...new Set(tools.map((tool) => tool.category))];
    filterRoot.innerHTML = categories.map((category) => `<button type="button" class="filter-button ${category === selectedCategory ? 'is-selected' : ''}" aria-pressed="${category === selectedCategory}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join('');
    filterRoot.addEventListener('click', (event) => {
      const button = event.target.closest('[data-category]');
      if (!button) return;
      selectedCategory = button.dataset.category;
      filterRoot.querySelectorAll('[data-category]').forEach((item) => {
        const selected = item === button;
        item.classList.toggle('is-selected', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
      render();
    });
    search.addEventListener('input', render);
    render();
  } catch (error) {
    console.error(error);
    grid.innerHTML = '<div class="empty-state">The toolkit is having a moment. Please refresh and try again.</div>';
  }
}

load();
