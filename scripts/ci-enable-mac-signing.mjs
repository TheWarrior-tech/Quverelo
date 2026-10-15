#!/usr/bin/env node
/**
 * CI only (macOS job, when the MAC_CSC_LINK secret exists): turn the unsigned mac
 * build into a Developer ID signed, hardened-runtime, notarised one so Squirrel.Mac
 * can install updates. Edits package.json in the CI checkout; never committed.
 * Needs CSC_LINK / CSC_KEY_PASSWORD (Developer ID Application .p12, base64) and
 * APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID for notarisation.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const mac = pkg.build.mac;
delete mac.identity; // null forces unsigned; let electron-builder use CSC_LINK
mac.hardenedRuntime = true;
mac.gatekeeperAssess = false;
mac.notarize = true;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('macOS signing enabled: hardenedRuntime, notarize');
