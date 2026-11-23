import { describe, it, expect, beforeAll } from 'vitest';
import { devSid } from '@foundation/dev-sid.js';
import { devHostname, parseDevHost, slug, signDevTicket, verifyDevTicket } from '@server/dev-host.js';

const ID = '3f9a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';
const DOMAIN = 'beta.workshop.chu.zone';

beforeAll(() => {
  process.env.WORKSHOP_AUTH_TOKEN = 'a'.repeat(64);
});

describe('dev hostnames', () => {
  it('builds a single-label host from the track slug and a 12-char sid', () => {
    expect(devSid(ID)).toBe('3f9a1c2e4b5d');
    expect(devHostname('Nozzle Works!', ID, DOMAIN)).toBe('nozzle-works-3f9a1c2e4b5d.beta.workshop.chu.zone');
    expect(slug('***')).toBe('session');
  });

  it('parses the sid back out, ignoring the slug, case and port', () => {
    expect(parseDevHost('Nozzle-Works-3F9A1C2E4B5D.beta.workshop.chu.zone:443', DOMAIN)).toBe('3f9a1c2e4b5d');
    expect(parseDevHost('3f9a1c2e4b5d.beta.workshop.chu.zone', DOMAIN)).toBe('3f9a1c2e4b5d');
  });

  it('rejects other domains, nested labels and bad sids', () => {
    expect(parseDevHost('workshop.chu.zone', DOMAIN)).toBeNull();
    expect(parseDevHost('x-3f9a1c2e4b5d.evilbeta.workshop.chu.zone', DOMAIN)).toBeNull();
    expect(parseDevHost('a.x-3f9a1c2e4b5d.beta.workshop.chu.zone', DOMAIN)).toBeNull();
    expect(parseDevHost('x-3f9a1c2e.beta.workshop.chu.zone', DOMAIN)).toBeNull();
    expect(parseDevHost(undefined, DOMAIN)).toBeNull();
  });
});

describe('dev tickets', () => {
  it('verifies for the same sid until expiry', () => {
    const now = Date.now();
    const ticket = signDevTicket('3f9a1c2e4b5d', 60, now);
    expect(verifyDevTicket(ticket, '3f9a1c2e4b5d', now)).toBe(true);
    expect(verifyDevTicket(ticket, '000000000000', now)).toBe(false);
    expect(verifyDevTicket(ticket, '3f9a1c2e4b5d', now + 61_000)).toBe(false);
  });

  it('rejects malformed and tampered tickets', () => {
    const ticket = signDevTicket('3f9a1c2e4b5d', 60);
    const [exp] = ticket.split('.');
    expect(verifyDevTicket(`${Number(exp) + 1000}.${ticket.split('.')[1]}`, '3f9a1c2e4b5d')).toBe(false);
    expect(verifyDevTicket('garbage', '3f9a1c2e4b5d')).toBe(false);
    expect(verifyDevTicket(null, '3f9a1c2e4b5d')).toBe(false);
  });
});

describe('Workshop credentials from dev-host pages', () => {
  it('are ignored when the request Origin is a dev host', async () => {
    process.env.WORKSHOP_DEV_DOMAIN = DOMAIN;
    const { extractToken } = await import('@server/auth-middleware.js');
    const req = (origin?: string) =>
      ({ headers: { host: 'workshop.chu.zone', cookie: 'workshop_token=abc', origin }, url: '/' }) as never;
    expect(extractToken(req(`https://x-3f9a1c2e4b5d.${DOMAIN}`))).toBeNull();
    expect(extractToken(req('https://workshop.chu.zone'))).toBe('abc');
    expect(extractToken(req(`https://evil.${DOMAIN}`))).toBe('abc');
    expect(extractToken(req())).toBe('abc');
    delete process.env.WORKSHOP_DEV_DOMAIN;
  });

  it('are ignored for same-site subresource loads but not top-level navigation', async () => {
    process.env.WORKSHOP_DEV_DOMAIN = DOMAIN;
    const { extractToken } = await import('@server/auth-middleware.js');
    const req = (site: string, dest: string) =>
      ({
        headers: { host: 'workshop.chu.zone', cookie: 'workshop_token=abc', 'sec-fetch-site': site, 'sec-fetch-dest': dest },
        url: '/',
      }) as never;
    expect(extractToken(req('same-site', 'image'))).toBeNull();
    expect(extractToken(req('same-site', 'iframe'))).toBeNull();
    expect(extractToken(req('same-site', 'document'))).toBe('abc');
    expect(extractToken(req('same-origin', 'empty'))).toBe('abc');
    delete process.env.WORKSHOP_DEV_DOMAIN;
  });
});
