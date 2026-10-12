/*
 * Sidebar layout: on desktop, the top bar drawers become a collapsible navigation rail on the left,
 * the selected drawer is docked next to it, and the chat fills the rest of the screen.
 * The layout itself lives in css/ui-sidebar.css; this module only toggles the body classes and
 * adjusts drawer behavior (one docked panel at a time, remembered across reloads).
 */

import { power_user } from './power-user.js';
import { accountStorage } from './util/AccountStorage.js';
import { t } from './i18n.js';

const DESKTOP_QUERY = window.matchMedia('(min-width: 1001px)');
const RAIL_EXPANDED_KEY = 'SidebarRailExpanded';
const ACTIVE_PANEL_KEY = 'SidebarActivePanel';
const PANEL_WIDTH_KEY = 'SidebarPanelWidth';

/**
 * Checks if the sidebar layout is currently in effect.
 * @returns {boolean} True if drawers are docked in the sidebar
 */
export function isSidebarLayout() {
    return document.body.classList.contains('sidebarLayout') && DESKTOP_QUERY.matches;
}

/**
 * Closes all open top bar drawers, including pinned ones.
 */
function closeAllDrawers() {
    $('#top-settings-holder .drawer-content.openDrawer').toggleClass('openDrawer closedDrawer');
    $('#top-settings-holder .drawer-icon.openIcon').toggleClass('openIcon closedIcon');
}

/**
 * Enables or disables the sidebar layout according to the user settings.
 * MovingUI positions panels freely, so it always uses the classic layout.
 */
export function applySidebarLayout() {
    const enabled = !!power_user.sidebar_layout && !power_user.movingUI;
    if (document.body.classList.contains('sidebarLayout') === enabled) {
        return;
    }

    // Maximized drawers are sized for the classic layout
    $('#top-settings-holder .drawer-content.maximized').each(function () {
        $(this).find('.inline-drawer-maximize').trigger('click');
    });
    closeAllDrawers();
    document.body.classList.toggle('sidebarLayout', enabled);
}

/**
 * Remembers which drawer is docked, so it can be restored after a reload.
 * @param {string|null} drawerId ID of the open drawer content, or null if none is open
 */
export function rememberActivePanel(drawerId) {
    if (!isSidebarLayout()) {
        return;
    }

    if (drawerId) {
        accountStorage.setItem(ACTIVE_PANEL_KEY, drawerId);
    } else {
        accountStorage.removeItem(ACTIVE_PANEL_KEY);
    }
}

/**
 * Opens the drawer that was docked before the page was reloaded.
 */
export function restoreActivePanel() {
    const drawerId = accountStorage.getItem(ACTIVE_PANEL_KEY);
    if (!drawerId) {
        return;
    }

    const drawer = $(`#top-settings-holder #${CSS.escape(drawerId)}.drawer-content`);
    if (drawer.length && !drawer.hasClass('openDrawer')) {
        drawer.siblings('.drawer-toggle').trigger('click');
    }
}

/**
 * Adds a text label to drawers that don't have one (e.g. added by extensions), using the tooltip.
 */
function addMissingLabels() {
    for (const toggle of document.querySelectorAll('#top-settings-holder > .drawer > .drawer-toggle')) {
        if (toggle.querySelector('.drawer-label')) {
            continue;
        }

        const title = toggle.getAttribute('title') || toggle.querySelector('.drawer-icon')?.getAttribute('title');
        if (!title) {
            continue;
        }

        const label = document.createElement('span');
        label.classList.add('drawer-label');
        label.textContent = title;
        toggle.append(label);
    }
}

/**
 * Updates the rail toggle button to match the rail state.
 * @param {HTMLElement} button Rail toggle button
 */
function updateRailToggle(button) {
    const expanded = document.body.classList.contains('sidebarRailExpanded');
    const title = expanded ? t`Collapse navigation` : t`Expand navigation`;
    button.classList.toggle('lucide-panel-left-close', expanded);
    button.classList.toggle('lucide-panel-left-open', !expanded);
    button.title = title;
    button.setAttribute('aria-label', title);
    button.setAttribute('aria-expanded', String(expanded));
}

/**
 * Sets the preferred width of the docked panel. CSS keeps it within the allowed range.
 * @param {number|null} width Width in pixels, or null for the default width
 */
function setPanelWidth(width) {
    if (width) {
        document.body.style.setProperty('--ui-panel-width-pref', `${Math.round(width)}px`);
    } else {
        document.body.style.removeProperty('--ui-panel-width-pref');
    }
}

/**
 * Creates the drag handle that resizes the docked panel. Double-click resets the width.
 */
function initPanelResizer() {
    const resizer = document.createElement('div');
    resizer.id = 'sidebarPanelResizer';
    resizer.setAttribute('role', 'separator');
    resizer.setAttribute('aria-orientation', 'vertical');
    document.body.append(resizer);

    const savedWidth = Number(accountStorage.getItem(PANEL_WIDTH_KEY));
    setPanelWidth(savedWidth > 0 ? savedWidth : null);

    resizer.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        resizer.setPointerCapture(e.pointerId);
        document.body.classList.add('sidebarResizing');
    });
    resizer.addEventListener('pointermove', (e) => {
        if (!resizer.hasPointerCapture(e.pointerId)) {
            return;
        }
        const railWidth = document.getElementById('top-settings-holder').getBoundingClientRect().width;
        setPanelWidth(e.clientX - railWidth);
    });
    resizer.addEventListener('pointerup', (e) => {
        resizer.releasePointerCapture(e.pointerId);
        document.body.classList.remove('sidebarResizing');
        const panel = document.querySelector('#top-settings-holder .drawer-content.openDrawer');
        if (panel) {
            const width = panel.getBoundingClientRect().width;
            setPanelWidth(width);
            accountStorage.setItem(PANEL_WIDTH_KEY, String(Math.round(width)));
        }
    });
    resizer.addEventListener('dblclick', () => {
        setPanelWidth(null);
        accountStorage.removeItem(PANEL_WIDTH_KEY);
    });
}

/**
 * Sets up the rail toggle, drawer labels and the layout observers. Call once on startup.
 */
export function initSidebarLayout() {
    const holder = document.getElementById('top-settings-holder');
    if (!holder) {
        return;
    }

    document.body.classList.toggle('sidebarRailExpanded', accountStorage.getItem(RAIL_EXPANDED_KEY) === 'true');

    const button = document.createElement('div');
    button.id = 'sidebarRailToggle';
    button.classList.add('menu_button', 'lucide');
    button.setAttribute('role', 'button');
    button.tabIndex = 0;
    updateRailToggle(button);
    button.addEventListener('click', () => {
        const expanded = document.body.classList.toggle('sidebarRailExpanded');
        accountStorage.setItem(RAIL_EXPANDED_KEY, String(expanded));
        updateRailToggle(button);
    });
    button.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            button.click();
        }
    });
    holder.append(button);

    initPanelResizer();
    addMissingLabels();
    new MutationObserver(() => {
        addMissingLabels();
        // Keep the toggle at the bottom when extensions add drawers
        if (holder.lastElementChild !== button) {
            holder.append(button);
        }
    }).observe(holder, { childList: true });

    // Leaving the desktop width falls back to the mobile layout, which expects the classic drawer behavior
    DESKTOP_QUERY.addEventListener('change', () => {
        if (document.body.classList.contains('sidebarLayout')) {
            closeAllDrawers();
        }
    });
}
