import { initAccessibility } from './a11y.js';
import { DEFAULT_LOCALE } from './constants.js';

/**
 * CRSF token for requests.
 */
let csrfToken = '';
let discreetLogin = false;

/**
 * Translations of the current UI language.
 * @type {Record<string, string>}
 */
let localeData = {};

/**
 * Messages for the error codes passed by the GitHub callback. Keep in sync with src/endpoints/github-auth.js.
 * @type {Record<string, string>}
 */
const GITHUB_ERRORS = {
    denied: 'GitHub authorization was cancelled.',
    state: 'The login session has expired. Please try again.',
    github: 'Could not complete the login with GitHub. Please try again later.',
    not_allowed: 'This GitHub account is not allowed to access this server.',
    not_linked: 'This GitHub account is not linked to a user on this server. Ask the server administrator to link it.',
    already_linked: 'The user for this GitHub account is already linked to another GitHub account.',
    disabled: 'User is disabled',
    rate_limited: 'Too many attempts. Try again later.',
};

/**
 * Loads the translations for the UI language picked in the app, or the default language.
 * @returns {Promise<void>}
 */
async function loadLocale() {
    let language = DEFAULT_LOCALE;
    try {
        language = String(localStorage.getItem('language') || DEFAULT_LOCALE).toLowerCase();
    } catch {
        // Storage is not available, use the default language
    }

    document.documentElement.lang = language;

    try {
        const languages = await fetch('/locales/lang.json').then(response => response.json());
        if (Array.isArray(languages) && languages.some(x => x.lang === language)) {
            const response = await fetch(`/locales/${language}.json`);
            localeData = response.ok ? await response.json() : {};
        }
    } catch (error) {
        console.error('Failed to load locale data', error);
    }
}

/**
 * Translates a text to the UI language.
 * @param {string} text Text in English
 * @returns {string} Translated text, or the original if there is no translation
 */
function translate(text) {
    return localeData[text] || text;
}

/**
 * Translates the elements with a data-i18n attribute, using the same format as the main app.
 */
function applyLocale() {
    for (const element of document.querySelectorAll('[data-i18n]')) {
        for (const key of element.getAttribute('data-i18n').split(';')) {
            const attributeMatch = key.match(/\[(\S+)\](.+)/);
            if (attributeMatch) {
                const value = localeData[attributeMatch[2]];
                if (value) {
                    element.setAttribute(attributeMatch[1], value);
                }
            } else if (localeData[key]) {
                element.textContent = localeData[key];
            }
        }
    }
}

/**
 * Gets the login methods enabled on the server.
 * @returns {Promise<{password: boolean, github: boolean}>} Enabled login methods
 */
async function getAuthMethods() {
    try {
        const response = await fetch('/api/users/auth-methods', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
            },
        });

        if (response.ok) {
            return await response.json();
        }
    } catch (error) {
        console.error('Failed to get login methods', error);
    }

    // Older servers only support password login
    return { password: true, github: false };
}

/**
 * Gets a CSRF token from the server.
 * @returns {Promise<string>} CSRF token
 */
async function getCsrfToken() {
    const response = await fetch('/csrf-token');
    const data = await response.json();
    return data.token;
}

/**
 * Gets a list of users from the server.
 * @returns {Promise<object>} List of users
 */
async function getUserList() {
    const response = await fetch('/api/users/list', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
        },
    });

    if (!response.ok) {
        const errorData = await response.json();
        return displayError(errorData.error || 'An error occurred');
    }

    if (response.status === 204) {
        discreetLogin = true;
        return [];
    }

    const userListObj = await response.json();
    console.log(userListObj);
    return userListObj;
}

/**
 * Requests a recovery code for the user.
 * @param {string} handle User handle
 * @returns {Promise<void>}
 */
async function sendRecoveryPart1(handle) {
    const response = await fetch('/api/users/recover-step1', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ handle }),
    });

    if (!response.ok) {
        const errorData = await response.json();
        return displayError(errorData.error || 'An error occurred');
    }

    showRecoveryBlock();
}

/**
 * Sets a new password for the user using the recovery code.
 * @param {string} handle User handle
 * @param {string} code Recovery code
 * @param {string} newPassword New password
 * @returns {Promise<void>}
 */
async function sendRecoveryPart2(handle, code, newPassword) {
    const recoveryData = {
        handle,
        code,
        newPassword,
    };

    const response = await fetch('/api/users/recover-step2', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(recoveryData),
    });

    if (!response.ok) {
        const errorData = await response.json();
        return displayError(errorData.error || 'An error occurred');
    }

    console.log(`Successfully recovered password for ${handle}!`);
    await performLogin(handle, newPassword);
}

/**
 * Attempts to log in the user.
 * @param {string} handle User's handle
 * @param {string} password User's password
 * @returns {Promise<void>}
 */
async function performLogin(handle, password) {
    const userInfo = {
        handle: handle,
        password: password,
    };

    try {
        const response = await fetch('/api/users/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify(userInfo),
        });

        if (!response.ok) {
            const errorData = await response.json();
            return displayError(errorData.error || 'An error occurred');
        }

        const data = await response.json();

        if (data.handle) {
            console.log(`Successfully logged in as ${handle}!`);
            redirectToHome();
        }
    } catch (error) {
        console.error('Error logging in:', error);
        displayError(String(error));
    }
}

/**
 * Handles the user selection event.
 * @param {object} user User object
 * @returns {Promise<void>}
 */
async function onUserSelected(user) {
    // No password, just log in
    if (!user.password) {
        return await performLogin(user.handle, '');
    }

    $('.userSelect').removeClass('selected');
    $(`.userSelect[data-handle="${CSS.escape(user.handle)}"]`).addClass('selected');
    $('#passwordRecoveryBlock').hide();
    $('#passwordEntryBlock').show();
    $('#userPassword').trigger('focus');
    $('#loginButton').off('click').on('click', async () => {
        const password = String($('#userPassword').val());
        await performLogin(user.handle, password);
    });

    $('#recoverPassword').off('click').on('click', async () => {
        await sendRecoveryPart1(user.handle);
    });

    $('#sendRecovery').off('click').on('click', async () => {
        const code = String($('#recoveryCode').val());
        const newPassword = String($('#newPassword').val());
        await sendRecoveryPart2(user.handle, code, newPassword);
    });

    displayError('');
}

/**
 * Displays an error message to the user.
 * @param {string} message Error message
 */
function displayError(message) {
    $('#errorMessage').text(translate(message));
}

/**
 * Redirects the user to the home page.
 * Preserves the query string.
 */
function redirectToHome() {
    // Create a URL object based on the current location
    const currentUrl = new URL(window.location.href);

    // After a login there's no need to preserve the
    // noauto parameter (if present)
    currentUrl.searchParams.delete('noauto');

    // Set the pathname to root and keep the updated query string
    currentUrl.pathname = '/';

    // Redirect to the new URL
    window.location.href = currentUrl.toString();
}

/**
 * Hides the password entry block and shows the password recovery block.
 */
function showRecoveryBlock() {
    $('#passwordEntryBlock').hide();
    $('#passwordRecoveryBlock').show();
    displayError('');
}

/**
 * Hides the password recovery block and shows the password entry block.
 */
function onCancelRecoveryClick() {
    $('#passwordRecoveryBlock').hide();
    $('#passwordEntryBlock').show();
    displayError('');
}

/**
 * Configures the login page for normal login.
 * @param {import('../../src/users').UserViewModel[]} userList List of users
 */
function configureNormalLogin(userList) {
    console.log('Discreet login is disabled');
    $('#handleEntryBlock').hide();
    $('#normalLoginPrompt').show();
    $('#discreetLoginPrompt').hide();
    console.log(userList);
    for (const user of userList) {
        const userBlock = $('<div></div>').addClass('userSelect').attr('data-handle', user.handle);
        const avatarBlock = $('<div></div>').addClass('avatar');
        avatarBlock.append($('<img>').attr('src', user.avatar));
        userBlock.append(avatarBlock);
        userBlock.append($('<span></span>').addClass('userName').text(user.name));
        userBlock.append($('<small></small>').addClass('userHandle').text(user.handle));
        userBlock.on('click', () => onUserSelected(user));
        $('#userList').append(userBlock);
    }
}

/**
 * Configures the login page for discreet login.
 */
function configureDiscreetLogin() {
    console.log('Discreet login is enabled');
    $('#handleEntryBlock').show();
    $('#normalLoginPrompt').hide();
    $('#discreetLoginPrompt').show();
    $('#userList').hide();
    $('#passwordRecoveryBlock').hide();
    $('#passwordEntryBlock').show();
    $('#loginButton').off('click').on('click', async () => {
        const handle = String($('#userHandle').val());
        const password = String($('#userPassword').val());
        await performLogin(handle, password);
    });

    $('#recoverPassword').off('click').on('click', async () => {
        const handle = String($('#userHandle').val());
        await sendRecoveryPart1(handle);
    });

    $('#sendRecovery').off('click').on('click', async () => {
        const handle = String($('#userHandle').val());
        const code = String($('#recoveryCode').val());
        const newPassword = String($('#newPassword').val());
        await sendRecoveryPart2(handle, code, newPassword);
    });
}

/**
 * Configures the GitHub login button.
 */
function configureGithubLogin() {
    $('#githubLoginBlock').show();

    // Return to the same query string after the login, like the password login does
    const query = window.location.search;
    $('#githubLoginButton').attr('href', `auth/github/login${query}`);
}

/**
 * Shows the error passed back by the GitHub login, and removes it from the address bar.
 */
function showGithubError() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('github_error');
    if (!code) {
        return;
    }

    displayError(GITHUB_ERRORS[code] ?? GITHUB_ERRORS.github);
    url.searchParams.delete('github_error');
    window.history.replaceState(null, '', url.toString());
}

(async function () {
    initAccessibility();
    await loadLocale();
    applyLocale();

    csrfToken = await getCsrfToken();
    const authMethods = await getAuthMethods();

    if (authMethods.github) {
        configureGithubLogin();
    }

    if (authMethods.password) {
        const userList = await getUserList();
        $('#userSelectBlock').show();

        if (discreetLogin) {
            configureDiscreetLogin();
        } else {
            configureNormalLogin(userList);
        }
    }

    if (authMethods.github && authMethods.password) {
        $('#authDivider').show();
        $('#authDescription').text(translate('Sign in with GitHub or a local account.'));
    } else if (authMethods.github) {
        $('#authDescription').text(translate('Sign in with your GitHub account to continue.'));
    }

    showGithubError();
    document.getElementById('authPage').style.opacity = '';
    $('#cancelRecovery').on('click', onCancelRecoveryClick);
    $(document).on('keydown', (evt) => {
        if (evt.key === 'Enter' && document.activeElement.tagName === 'INPUT') {
            if ($('#passwordRecoveryBlock').is(':visible')) {
                $('#sendRecovery').trigger('click');
            } else {
                $('#loginButton').trigger('click');
            }
        }
    });
})();
