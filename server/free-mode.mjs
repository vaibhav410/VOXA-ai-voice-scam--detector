// FREE_MODE keeps VOXA from calling any account that could be billed.
// A provider is allowed only after the user confirms its account has no payment method or auto top-up.
export const PROVIDERS = {
  realitydefender: {label: 'Reality Defender', cls: 'free-tier', docs: 'https://www.realitydefender.com/api-email-campaign', note: 'Free API plan: 50 scans a month, audio and image only, no card at sign-up. Video needs a sales agreement. Overage terms are unclear, so confirm the account has no payment method.'},
  gemini: {label: 'Gemini', cls: 'free-tier', docs: 'https://ai.google.dev/gemini-api/docs/pricing', note: 'Free only while the key\'s Google project has billing disabled. Free-tier content may be used to improve Google products.'},
  deepgram: {label: 'Deepgram', cls: 'trial-credit', docs: 'https://deepgram.com/pricing', note: 'One-time $200 credit, no card at sign-up. Pay-as-you-go afterwards; keep auto top-up off.'},
  sealedrose: {label: 'Sealed Rose', cls: 'trial-credit', docs: 'https://sealedrose.com/developers', note: '25 test credits, then paid prepaid packs. Video costs 12 credits, other media 1.'},
  luxand: {label: 'Luxand', cls: 'unverified', docs: 'https://luxand.cloud/pricing', note: 'Third-party listings say 500 free requests a month; the official pricing page could not be verified.'}
};
export const freeModeOn = (env = process.env) => !/^(0|false|off|no)$/i.test(String(env.FREE_MODE ?? '1').trim());
export const confirmed = (env = process.env) => new Set(String(env.FREE_MODE_CONFIRMED || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
export function blockReason(name, env = process.env) {
  const p = PROVIDERS[name];
  if (!p || !freeModeOn(env) || confirmed(env).has(name)) return null;
  return `Blocked by FREE_MODE: ${p.label} is a ${p.cls} service. Confirm its account has no payment method or auto top-up by adding "${name}" to FREE_MODE_CONFIRMED in .env.local, or set FREE_MODE=off.`;
}
