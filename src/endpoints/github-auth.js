import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

import express from 'express';
import fetch from 'node-fetch';
import storage from 'node-persist';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';

import { getIpAddress } from '../express-common.js';
import { color, getConfigValue } from '../util.js';
import {
    KEY_PREFIX,
    toKey,
    toAvatarKey,
    getAccountVersion,
    getPasswordSalt,
    getUserDirectories,
    ensurePublicDirectoriesExist,
    isGithubLoginEnabled,
} from '../users.js';
import { checkForNewContent, CONTENT_TYPES } from './content-manager.js';
import { slugify } from './users-admin.js';

const CLIENT_ID = String(getConfigValue('sso.github.clientId', '') ?? '');
const CLIENT_SECRET = String(getConfigValue('sso.github.clientSecret', '') ?? '');
const CALLBACK_URL = String(getConfigValue('sso.github.callbackUrl', '') ?? '');
const AUTO_CREATE_USERS = getConfigValue('sso.github.autoCreateUsers', false, 'boolean');
const PREFER_REAL_IP_HEADER = getConfigValue('rateLimiting.preferRealIpHeader', false, 'boolean');

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const REQUEST_TIMEOUT = 15_000;
const STATE_MAX_AGE = 10 * 60 * 1000;
const MAX_AVATAR_SIZE = 1024 * 1024;

/**
 * Error codes passed to the login page. Keep in sync with public/scripts/login.js.
 * @readonly
 */
const ERRORS = Object.freeze({
    DENIED: 'denied',
    STATE: 'state',
    GITHUB: 'github',
    NOT_ALLOWED: 'not_allowed',
    NOT_LINKED: 'not_linked',
    ALREADY_LINKED: 'already_linked',
    DISABLED: 'disabled',
    RATE_LIMITED: 'rate_limited',
});

/**
 * @typedef {object} GithubUser
 * @property {number} id Numeric account ID. Unlike the login, it never changes.
 * @property {string} login Account username
 * @property {string|null} name Display name
 * @property {string} avatar_url Avatar image URL
 */

/**
 * @typedef {object} GithubAuthState
 * @property {string} state Random value to match the callback against
 * @property {string} redirectUri Callback URL sent to GitHub
 * @property {string} query Query string of the page that started the login
 * @property {number} created Timestamp of the login attempt
 */

class GithubLoginError extends Error {
    /**
     * @param {string} code One of ERRORS
     * @param {string} message Message for the server console
     */
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

export const router = express.Router();

const callbackLimiter = new RateLimiterMemory({
    points: 10,
    duration: 60,
});

/**
 * Lowercases a list of GitHub logins from the config.
 * @param {unknown} value Config value
 * @returns {string[]} Lowercase logins
 */
function getLoginList(value) {
    return Array.isArray(value) ? value.map(x => String(x).trim().toLowerCase()).filter(Boolean) : [];
}

/**
 * Lowercases the keys of the GitHub login to user handle map from the config.
 * @param {unknown} value Config value
 * @returns {Map<string, string>} Map of lowercase GitHub logins to user handles
 */
function getAccountMapping(value) {
    const mapping = new Map();
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [login, handle] of Object.entries(value)) {
            if (handle) {
                mapping.set(login.trim().toLowerCase(), String(handle).trim());
            }
        }
    }
    return mapping;
}

const ALLOWED_USERS = getLoginList(getConfigValue('sso.github.allowedUsers', []));
const ACCOUNT_MAPPING = getAccountMapping(getConfigValue('sso.github.accountMapping', {}));

/**
 * Gets the callback URL registered in the GitHub OAuth app.
 * @param {import('express').Request} request Request object
 * @returns {string} Callback URL
 */
function getRedirectUri(request) {
    if (CALLBACK_URL) {
        return CALLBACK_URL;
    }

    return `${request.protocol}://${request.get('host')}/auth/github/callback`;
}

/**
 * Builds the URL of the page to return to after a successful login.
 * @param {string} query Query string of the page that started the login
 * @returns {string} Relative URL of the home page
 */
function getHomeUrl(query) {
    const params = new URLSearchParams(query);
    params.delete('noauto');
    params.delete('github_error');
    const search = params.toString();
    return search ? `/?${search}` : '/';
}

/**
 * Exchanges the authorization code for an access token.
 * @param {string} code Authorization code from the callback
 * @param {string} redirectUri Callback URL used in the authorization request
 * @returns {Promise<string>} Access token
 */
async function getAccessToken(code, redirectUri) {
    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code: code,
            redirect_uri: redirectUri,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });

    if (!response.ok) {
        throw new GithubLoginError(ERRORS.GITHUB, `Token request failed with status ${response.status}`);
    }

    /** @type {any} */
    const data = await response.json();

    // GitHub reports token errors with a 200 status
    if (data.error || !data.access_token) {
        throw new GithubLoginError(ERRORS.GITHUB, `Token request failed: ${data.error_description || data.error || 'no access token'}`);
    }

    return data.access_token;
}

/**
 * Gets the profile of the GitHub account that authorized the app.
 * @param {string} accessToken Access token
 * @returns {Promise<GithubUser>} GitHub account
 */
async function getGithubUser(accessToken) {
    const response = await fetch(USER_URL, {
        headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${accessToken}`,
            'User-Agent': 'SillyTavern',
            'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });

    if (!response.ok) {
        throw new GithubLoginError(ERRORS.GITHUB, `User request failed with status ${response.status}`);
    }

    /** @type {any} */
    const data = await response.json();

    if (!Number.isInteger(data?.id) || typeof data?.login !== 'string') {
        throw new GithubLoginError(ERRORS.GITHUB, 'User request returned an unexpected response');
    }

    return data;
}

/**
 * Downloads the GitHub avatar as a data URL.
 * @param {GithubUser} githubUser GitHub account
 * @returns {Promise<string|null>} Avatar data URL, or null if it can't be downloaded
 */
async function getGithubAvatar(githubUser) {
    try {
        const url = new URL(githubUser.avatar_url);
        url.searchParams.set('s', '256');
        const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
        const contentType = response.headers.get('content-type') ?? '';

        if (!response.ok || !contentType.startsWith('image/')) {
            return null;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > MAX_AVATAR_SIZE) {
            return null;
        }

        return `data:${contentType};base64,${buffer.toString('base64')}`;
    } catch (error) {
        console.warn('Could not download the GitHub avatar:', error.message);
        return null;
    }
}

/**
 * Creates a user account for a GitHub account.
 * @param {GithubUser} githubUser GitHub account
 * @param {import('../users.js').User[]} users Existing users
 * @returns {Promise<import('../users.js').User>} Created user
 */
async function createUser(githubUser, users) {
    const baseHandle = slugify(githubUser.login) || 'github-user';
    const handles = new Set(users.map(x => x.handle));
    let handle = baseHandle;
    for (let i = 2; handles.has(handle); i++) {
        handle = `${baseHandle}-${i}`;
    }

    /** @type {import('../users.js').User} */
    const user = {
        handle: handle,
        name: githubUser.name || githubUser.login,
        created: Date.now(),
        password: '',
        salt: getPasswordSalt(),
        admin: false,
        enabled: true,
        github: { id: githubUser.id, login: githubUser.login },
    };

    await storage.setItem(toKey(handle), user);

    const avatar = await getGithubAvatar(githubUser);
    if (avatar) {
        await storage.setItem(toAvatarKey(handle), avatar);
    }

    console.info('Creating data directories for', handle);
    await ensurePublicDirectoriesExist();
    await checkForNewContent([getUserDirectories(handle)], [CONTENT_TYPES.SETTINGS]);
    console.info(`Created user ${color.green(handle)} for GitHub account ${color.green(githubUser.login)}`);
    return user;
}

/**
 * Finds the user account linked to a GitHub account, linking or creating one if the config allows it.
 * @param {GithubUser} githubUser GitHub account
 * @returns {Promise<import('../users.js').User>} User account
 */
async function resolveUser(githubUser) {
    const login = githubUser.login.toLowerCase();

    if (ALLOWED_USERS.length > 0 && !ALLOWED_USERS.includes(login)) {
        throw new GithubLoginError(ERRORS.NOT_ALLOWED, `GitHub account ${githubUser.login} is not in sso.github.allowedUsers`);
    }

    /** @type {import('../users.js').User[]} */
    const users = await storage.values(x => x.key.startsWith(KEY_PREFIX));

    // Accounts are matched by ID, so renaming the GitHub account doesn't lose access
    const linkedUser = users.find(x => x.github?.id === githubUser.id);
    if (linkedUser) {
        if (linkedUser.github.login !== githubUser.login) {
            linkedUser.github.login = githubUser.login;
            await storage.setItem(toKey(linkedUser.handle), linkedUser);
        }
        return linkedUser;
    }

    const mappedHandle = ACCOUNT_MAPPING.get(login);
    if (mappedHandle) {
        const mappedUser = users.find(x => x.handle === mappedHandle);
        if (!mappedUser) {
            throw new GithubLoginError(ERRORS.NOT_LINKED, `sso.github.accountMapping points ${githubUser.login} to user ${mappedHandle}, which does not exist`);
        }
        if (mappedUser.github) {
            throw new GithubLoginError(ERRORS.ALREADY_LINKED, `User ${mappedHandle} is already linked to GitHub account ${mappedUser.github.login} (ID ${mappedUser.github.id})`);
        }
        mappedUser.github = { id: githubUser.id, login: githubUser.login };
        await storage.setItem(toKey(mappedUser.handle), mappedUser);
        console.info(`Linked user ${color.green(mappedUser.handle)} to GitHub account ${color.green(githubUser.login)}`);
        return mappedUser;
    }

    if (AUTO_CREATE_USERS) {
        return await createUser(githubUser, users);
    }

    throw new GithubLoginError(ERRORS.NOT_LINKED, `GitHub account ${githubUser.login} is not linked to a user. Add it to sso.github.accountMapping or enable sso.github.autoCreateUsers`);
}

router.get('/login', (request, response) => {
    if (!isGithubLoginEnabled() || !request.session) {
        return response.redirect('/login');
    }

    const redirectUri = getRedirectUri(request);
    const state = crypto.randomBytes(24).toString('hex');

    /** @type {GithubAuthState} */
    const authState = {
        state: state,
        redirectUri: redirectUri,
        query: request.url.split('?')[1] ?? '',
        created: Date.now(),
    };
    request.session.githubAuth = authState;

    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('allow_signup', 'false');
    return response.redirect(url.toString());
});

router.get('/callback', async (request, response) => {
    if (!isGithubLoginEnabled() || !request.session) {
        return response.redirect('/login');
    }

    /** @type {GithubAuthState|undefined} */
    const authState = request.session.githubAuth;
    request.session.githubAuth = null;
    const ip = getIpAddress(request, PREFER_REAL_IP_HEADER);

    try {
        if (request.query.error) {
            throw new GithubLoginError(ERRORS.DENIED, `Authorization was not granted: ${request.query.error}`);
        }

        const state = String(request.query.state ?? '');
        const isStateValid = !!authState
            && Date.now() - authState.created < STATE_MAX_AGE
            && state.length === authState.state.length
            && crypto.timingSafeEqual(Buffer.from(state), Buffer.from(authState.state));

        if (!isStateValid) {
            throw new GithubLoginError(ERRORS.STATE, 'State is missing, expired or does not match');
        }

        await callbackLimiter.consume(ip);

        const accessToken = await getAccessToken(String(request.query.code ?? ''), authState.redirectUri);
        const githubUser = await getGithubUser(accessToken);
        const user = await resolveUser(githubUser);

        if (!user.enabled) {
            throw new GithubLoginError(ERRORS.DISABLED, `User ${user.handle} is disabled`);
        }

        request.session.handle = user.handle;
        request.session.version = getAccountVersion(user);
        console.info('Login successful:', user.handle, `(GitHub: ${githubUser.login})`, 'from', ip, 'at', new Date().toLocaleString());
        return response.redirect(getHomeUrl(authState.query));
    } catch (error) {
        let code = ERRORS.GITHUB;

        if (error instanceof RateLimiterRes) {
            code = ERRORS.RATE_LIMITED;
            console.warn('GitHub login failed: Rate limited from', ip);
        } else if (error instanceof GithubLoginError) {
            code = error.code;
            console.warn('GitHub login failed:', error.message);
        } else {
            console.error('GitHub login failed:', error);
        }

        return response.redirect(`/login?github_error=${encodeURIComponent(code)}`);
    }
});
