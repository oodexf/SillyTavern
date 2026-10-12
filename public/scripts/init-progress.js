import { loader } from './action-loader.js';
import { t } from './i18n.js';

/**
 * @typedef {object} InitStep
 * @property {string} label Text shown while the step runs
 * @property {number} [weight=1] Share of the progress bar taken by the step
 * @property {() => any} run Step function
 */

/**
 * Splash screen of the app initialization. Shows a progress bar that advances
 * as each step of the loading process finishes, with the name of the current step.
 */
export class InitProgress {
    /** @type {HTMLDivElement} Overlay content for the loader */
    element;
    /** @type {HTMLDivElement} */
    #track;
    /** @type {HTMLDivElement} */
    #fill;
    /** @type {HTMLDivElement} */
    #pending;
    /** @type {HTMLSpanElement} */
    #label;
    /** @type {HTMLSpanElement} */
    #counter;
    /** @type {HTMLDivElement} */
    #error;
    #totalWeight = 0;
    #doneWeight = 0;
    #totalSteps = 0;
    #doneSteps = 0;

    constructor() {
        this.element = loader.createOverlay();
        this.element.classList.add('splash-screen');
        // The bar replaces the spinner
        this.element.querySelector('#load-spinner')?.remove();

        const logo = document.createElement('img');
        logo.src = '/img/logo.png';
        logo.alt = 'SillyTavern';
        logo.className = 'splash-logo';
        logo.ariaLabel = t`SillyTavern Logo`;

        const progress = document.createElement('div');
        progress.className = 'splash-progress';

        this.#track = document.createElement('div');
        this.#track.className = 'splash-progress-track';
        this.#track.setAttribute('role', 'progressbar');
        this.#track.setAttribute('aria-valuemin', '0');
        this.#track.setAttribute('aria-valuemax', '100');
        this.#track.setAttribute('aria-valuenow', '0');
        this.#track.setAttribute('aria-label', t`Loading progress`);

        this.#fill = document.createElement('div');
        this.#fill.className = 'splash-progress-fill';
        this.#pending = document.createElement('div');
        this.#pending.className = 'splash-progress-pending';
        this.#track.append(this.#pending, this.#fill);

        const status = document.createElement('div');
        status.className = 'splash-progress-status';
        this.#label = document.createElement('span');
        this.#label.className = 'splash-progress-label';
        this.#label.setAttribute('aria-live', 'polite');
        this.#label.textContent = t`Initializing…`;
        this.#counter = document.createElement('span');
        this.#counter.className = 'splash-progress-counter';
        status.append(this.#label, this.#counter);

        this.#error = document.createElement('div');
        this.#error.className = 'splash-progress-error';
        this.#error.hidden = true;

        progress.append(this.#track, status, this.#error);
        this.element.append(logo, progress);
    }

    /**
     * Runs the steps in order, advancing the bar after each one.
     * If a step fails, the splash screen shows the error and a reload button, and the error is rethrown.
     * @param {InitStep[]} steps Steps to run
     * @returns {Promise<void>}
     */
    async run(steps) {
        this.#totalWeight += steps.reduce((sum, step) => sum + (step.weight ?? 1), 0);
        this.#totalSteps += steps.length;

        for (const step of steps) {
            const weight = step.weight ?? 1;
            this.#setCurrent(step.label, weight);
            // Let the browser paint the label, synchronous steps would block it otherwise
            await new Promise(resolve => setTimeout(resolve, 0));

            try {
                await step.run();
            } catch (error) {
                this.#showError(step.label, error);
                throw error;
            }

            this.#doneWeight += weight;
            this.#doneSteps++;
            this.#render();
        }
    }

    /**
     * Fills the bar completely.
     */
    complete() {
        this.#doneWeight = this.#totalWeight;
        this.#doneSteps = this.#totalSteps;
        this.#label.textContent = t`Ready`;
        this.#setPending(0);
        this.#render();
    }

    /**
     * Shows the step that is running and the part of the bar it covers.
     * @param {string} label Step label
     * @param {number} weight Step weight
     */
    #setCurrent(label, weight) {
        this.#label.textContent = label;
        this.#setPending(weight);
        this.#render();
    }

    /**
     * @param {number} weight Weight of the running step
     */
    #setPending(weight) {
        const start = this.#percent(this.#doneWeight);
        const end = this.#percent(this.#doneWeight + weight);
        this.#pending.style.left = `${start}%`;
        this.#pending.style.width = `${end - start}%`;
    }

    #render() {
        const percent = this.#percent(this.#doneWeight);
        this.#fill.style.width = `${percent}%`;
        this.#track.setAttribute('aria-valuenow', String(Math.round(percent)));
        this.#counter.textContent = `${Math.min(this.#doneSteps + 1, this.#totalSteps)} / ${this.#totalSteps}`;
    }

    /**
     * @param {number} weight Weight to convert
     * @returns {number} Share of the total weight in percent
     */
    #percent(weight) {
        return this.#totalWeight > 0 ? Math.min(100, weight / this.#totalWeight * 100) : 0;
    }

    /**
     * @param {string} label Label of the failed step
     * @param {any} error Error thrown by the step
     */
    #showError(label, error) {
        this.element.classList.add('splash-failed');
        this.#setPending(0);
        this.#label.textContent = t`Loading failed: ${label}`;

        const message = document.createElement('p');
        message.textContent = error instanceof Error ? error.message : String(error);

        const reload = document.createElement('button');
        reload.type = 'button';
        reload.className = 'menu_button menu_button_icon';
        reload.innerHTML = '<i class="lucide lucide-refresh-cw"></i>';
        reload.append(document.createTextNode(t`Reload`));
        reload.addEventListener('click', () => location.reload());

        this.#error.replaceChildren(message, reload);
        this.#error.hidden = false;
    }
}
