import { describe, it, expect } from 'vitest';
import { issueBaseUrlFor, issueHref } from '@foundation/issue-tracker.js';

describe('issueHref', () => {
  it('links GitHub keys regardless of configured tracker', () => {
    const url = 'https://github.com/o/r/issues/7';
    expect(issueHref(issueBaseUrlFor('github', ''), 'o/r#7')).toBe(url);
    expect(issueHref(issueBaseUrlFor('linear', 'acme'), 'o/r#7')).toBe(url);
    expect(issueHref(undefined, 'o/r#7')).toBe(url);
  });

  it('links Linear keys only with an org', () => {
    expect(issueHref(issueBaseUrlFor('linear', 'acme'), 'ASY-1')).toBe(
      'https://linear.app/acme/issue/ASY-1',
    );
    expect(issueHref(issueBaseUrlFor('linear', ''), 'ASY-1')).toBeUndefined();
    expect(issueHref(undefined, undefined)).toBeUndefined();
  });
});
