(() => {
  const storageKey = 'kureijigaru.theme';
  const root = document.documentElement;
  let activeTooltipTarget = null;

  function readTheme() {
    try {
      return localStorage.getItem(storageKey) === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  }

  function setTheme(theme) {
    root.dataset.theme = theme;
    try {
      localStorage.setItem(storageKey, theme);
    } catch {
      // Keep the current-page toggle working when storage is unavailable.
    }

    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      const nextTheme = theme === 'dark' ? 'light' : 'dark';
      button.setAttribute('aria-label', `Switch to ${nextTheme} theme`);
      button.setAttribute('aria-pressed', String(theme === 'light'));
      const label = button.querySelector('[data-theme-label]');
      if (label) label.textContent = `${nextTheme[0].toUpperCase()}${nextTheme.slice(1)} theme`;
    });

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = theme === 'light' ? '#edf2f0' : '#111827';
  }

  function initializeTooltips() {
    let tooltip = document.getElementById('appTooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'appTooltip';
      tooltip.className = 'app-tooltip';
      tooltip.setAttribute('role', 'tooltip');
      tooltip.setAttribute('aria-hidden', 'true');
      document.body.append(tooltip);
    }

    function hideTooltip(target = activeTooltipTarget) {
      if (!target || target !== activeTooltipTarget) return;
      const describedBy = (target.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter((id) => id && id !== tooltip.id);
      if (describedBy.length) target.setAttribute('aria-describedby', describedBy.join(' '));
      else target.removeAttribute('aria-describedby');
      activeTooltipTarget = null;
      tooltip.dataset.visible = 'false';
      tooltip.setAttribute('aria-hidden', 'true');
    }

    function showTooltip(target) {
      const message = target?.dataset.tooltip;
      if (!message) return;
      if (activeTooltipTarget && activeTooltipTarget !== target) hideTooltip();

      activeTooltipTarget = target;
      tooltip.textContent = message;
      tooltip.dataset.visible = 'true';
      tooltip.setAttribute('aria-hidden', 'false');

      const describedBy = (target.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
      if (!describedBy.includes(tooltip.id)) describedBy.push(tooltip.id);
      target.setAttribute('aria-describedby', describedBy.join(' '));

      const targetRect = target.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const panelPlacement = target.closest('.left-panel') ? 'right' : target.closest('.right-panel') ? 'left' : '';
      const placement = target.dataset.tooltipPlacement || panelPlacement;
      const rightSpace = window.innerWidth - targetRect.right - 20;
      const leftSpace = targetRect.left - 20;
      let left;
      let top;

      if (placement === 'right' && rightSpace >= tooltipRect.width) {
        left = targetRect.right + 8;
        top = targetRect.top + (targetRect.height - tooltipRect.height) / 2;
      } else if (placement === 'left' && leftSpace >= tooltipRect.width) {
        left = targetRect.left - tooltipRect.width - 8;
        top = targetRect.top + (targetRect.height - tooltipRect.height) / 2;
      } else {
        left = Math.max(12, Math.min(
          targetRect.left + (targetRect.width - tooltipRect.width) / 2,
          window.innerWidth - tooltipRect.width - 12
        ));
        top = targetRect.bottom + 8;
        if (top + tooltipRect.height > window.innerHeight - 8) {
          top = targetRect.top - tooltipRect.height - 8;
        }
      }

      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${Math.max(8, Math.min(top, window.innerHeight - tooltipRect.height - 8))}px`;
    }

    document.addEventListener('pointerover', (event) => {
      const target = event.target.closest?.('[data-tooltip]');
      if (target) showTooltip(target);
    });

    document.addEventListener('pointerout', (event) => {
      const target = event.target.closest?.('[data-tooltip]');
      const nextTarget = event.relatedTarget?.closest?.('[data-tooltip]');
      if (target && target !== nextTarget) hideTooltip(target);
    });

    document.addEventListener('focusin', (event) => {
      const target = event.target.closest?.('[data-tooltip]');
      if (target) showTooltip(target);
    });

    document.addEventListener('focusout', (event) => {
      const target = event.target.closest?.('[data-tooltip]');
      const nextTarget = event.relatedTarget?.closest?.('[data-tooltip]');
      if (target && target !== nextTarget) hideTooltip(target);
    });

    window.addEventListener('resize', () => hideTooltip());
    window.addEventListener('scroll', () => hideTooltip(), true);
  }

  setTheme(readTheme());

  document.addEventListener('DOMContentLoaded', () => {
    setTheme(root.dataset.theme);
    initializeTooltips();
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
      });
    });
  });
})();
