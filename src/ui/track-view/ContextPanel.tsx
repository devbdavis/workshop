import type { Track } from '@foundation/types';

interface Props {
  track: Track;
}

export function ContextPanel({ track }: Props) {
  return (
    <div className="p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Context</h3>

      {track.repos && track.repos.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Repos</h4>
          <ul className="space-y-1">
            {track.repos.map((repo) => (
              <li key={repo.id} className="text-sm text-gray-400">
                <span className="font-mono text-xs">{repo.path}</span>
                {repo.branch && (
                  <span className="ml-2 text-xs text-blue-400">{repo.branch}</span>
                )}
                {repo.dirty && (
                  <span className="ml-1 text-xs text-yellow-500">modified</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {track.tickets && track.tickets.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
            Tickets
          </h4>
          <ul className="space-y-1">
            {track.tickets.map((ticket) => (
              <li key={ticket.id} className="text-sm text-gray-400">
                <span className="font-mono text-xs">{ticket.externalId}</span>
                {ticket.cachedTitle && (
                  <span className="ml-2">{ticket.cachedTitle}</span>
                )}
                {ticket.cachedStatus && (
                  <span className="ml-2 text-xs text-gray-500">{ticket.cachedStatus}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {track.paths && track.paths.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Paths</h4>
          <ul className="space-y-1">
            {track.paths.map((p) => (
              <li key={p.id} className="text-sm font-mono text-gray-400 text-xs">
                {p.label && <span className="text-gray-500 mr-2">{p.label}:</span>}
                {p.path}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(!track.repos || track.repos.length === 0) &&
        (!track.tickets || track.tickets.length === 0) &&
        (!track.paths || track.paths.length === 0) && (
          <p className="text-sm text-gray-500 italic">No context configured yet.</p>
        )}
    </div>
  );
}
