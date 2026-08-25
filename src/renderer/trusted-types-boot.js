import { installTrustedTypes } from './trusted-types-policy.js';

installTrustedTypes(window.trustedTypes, window.DOMPurify);
