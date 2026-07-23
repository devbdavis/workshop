import { useState, useRef, useEffect } from 'react';
import type { PullRequest } from '@foundation/types';
import { issueHref, isGithubIssueKey } from '@foundation/issue-tracker.js';

interface Props {
  pullRequests?: PullRequest[];
  issueKey?: string;
  /** Base URL for the issue tracker, e.g. "https://linear.app/klaviyo/issue/". Appended with issueKey to form the full link. */
  issueBaseUrl?: string;
}

/** Extract "owner/repo #N" from a GitHub PR URL, falling back to the raw URL. */
function parsePrLabel(url: string): string {
  try {
    const match = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
    if (match) return `${match[1]} #${match[2]}`;
  } catch { /* ignore */ }
  return url;
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z" />
    </svg>
  );
}

/**
 * Linear icon — a circle split diagonally: left half bright, right half slightly shaded.
 * Approximates Linear's half-circle logo mark as described.
 */
function LinearIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {/* Right (shaded) half */}
      <path d="M8 1.5 A6.5 6.5 0 0 1 8 14.5 Z" fill="currentColor" fillOpacity="0.35" />
      {/* Left (bright) half */}
      <path d="M8 1.5 A6.5 6.5 0 0 0 8 14.5 Z" fill="currentColor" fillOpacity="0.85" />
      {/* Circle border */}
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1" />
    </svg>
  );
}

/**
 * Renders GitHub PR and/or Linear ticket icon buttons for a session pane header.
 * Both are inserted to the left of the Cursor button.
 */
export function SessionLinkButtons({ pullRequests, issueKey, issueBaseUrl }: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    function handleOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [dropdownOpen]);

  const hasPrs = pullRequests !== undefined && pullRequests.length > 0;
  const hasIssue = Boolean(issueKey);

  if (!hasPrs && !hasIssue) return null;

  return (
    <>
      {hasIssue && (() => {
        const issueUrl = issueHref(issueBaseUrl, issueKey);
        const icon = isGithubIssueKey(issueKey) ? (
          <GitHubIcon className="w-3.5 h-3.5" />
        ) : (
          <LinearIcon className="w-3.5 h-3.5" />
        );
        return issueUrl ? (
          <a
            href={issueUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={issueKey}
            className="flex items-center px-1 text-gray-500 hover:text-blue-400"
          >
            {icon}
          </a>
        ) : (
          <span className="flex items-center px-1 text-gray-500 cursor-default" title={issueKey}>
            {icon}
          </span>
        );
      })()}

      {hasPrs && pullRequests!.length === 1 ? (
        <a
          href={pullRequests![0].url}
          target="_blank"
          rel="noopener noreferrer"
          title={parsePrLabel(pullRequests![0].url)}
          className="flex items-center text-gray-500 hover:text-blue-400 px-1"
        >
          <GitHubIcon className="w-3.5 h-3.5" />
        </a>
      ) : hasPrs ? (
        <div ref={dropdownRef} className="relative flex items-center px-1">
          <button
            onClick={() => setDropdownOpen((o) => !o)}
            className="flex items-center text-gray-500 hover:text-blue-400"
            title={`${pullRequests!.length} pull requests`}
          >
            <GitHubIcon className="w-3.5 h-3.5" />
          </button>
          {dropdownOpen && (
            <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded shadow-lg py-1 z-50 min-w-[200px]">
              {pullRequests!.map((pr, i) => (
                <a
                  key={i}
                  href={pr.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-3 py-1.5 text-xs text-gray-300 hover:text-blue-400 hover:bg-gray-700 truncate"
                  title={parsePrLabel(pr.url)}
                  onClick={() => setDropdownOpen(false)}
                >
                  {parsePrLabel(pr.url)}
                </a>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}
