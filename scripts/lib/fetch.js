/**
 * Proxy-aware fetch wrapper
 * Automatically uses HTTP_PROXY/HTTPS_PROXY if set
 * Falls back to native fetch if no proxy configured
 */

import { ProxyAgent, fetch as undiciFetch } from 'undici';

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
  || process.env.HTTP_PROXY || process.env.http_proxy
  || process.env.ALL_PROXY || process.env.all_proxy;

let dispatcher;
if (proxyUrl) {
  dispatcher = new ProxyAgent(proxyUrl);
  process.stderr.write(`[fetch] Using proxy: ${proxyUrl}\n`);
}

export default function proxyFetch(url, options = {}) {
  if (dispatcher) {
    return undiciFetch(url, { ...options, dispatcher });
  }
  return fetch(url, options);
}
