import { useState } from 'react';
import type { ExternalTicket, TicketSource, TicketRelationship } from '@foundation/types';

interface Props {
  trackId: string;
  tickets: ExternalTicket[];
  onUpdate: () => void;
}

export function TicketPanel({ trackId, tickets, onUpdate }: Props) {
  const [showAdd, setShowAdd] = useState(false);

  async function removeTicket(ticketId: string) {
    await fetch(`/api/tracks/${trackId}/tickets/${ticketId}`, { method: 'DELETE' });
    onUpdate();
  }

  async function addTicket(
    source: TicketSource,
    externalId: string,
    relationship: TicketRelationship,
  ) {
    await fetch(`/api/tracks/${trackId}/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, externalId, relationship }),
    });
    setShowAdd(false);
    onUpdate();
  }

  return (
    <div className="p-4 border-b border-gray-800">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-300">Tickets</h3>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          + Link
        </button>
      </div>

      {showAdd && <AddTicketForm onAdd={addTicket} onCancel={() => setShowAdd(false)} />}

      {tickets.length > 0 ? (
        <ul className="space-y-2">
          {tickets.map((ticket) => (
            <li
              key={ticket.id}
              className="flex items-start justify-between group text-sm"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-blue-400">{ticket.externalId}</span>
                  <span className="text-xs text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">
                    {ticket.source}
                  </span>
                  <span className="text-xs text-gray-600">{ticket.relationship}</span>
                </div>
                {ticket.cachedTitle && (
                  <p className="text-xs text-gray-400 mt-0.5">{ticket.cachedTitle}</p>
                )}
                {ticket.cachedStatus && (
                  <span className="text-xs text-gray-500">{ticket.cachedStatus}</span>
                )}
              </div>
              <button
                onClick={() => removeTicket(ticket.id)}
                className="text-xs text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 shrink-0 ml-2"
              >
                Unlink
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-gray-600 italic">No tickets linked.</p>
      )}
    </div>
  );
}

function AddTicketForm({
  onAdd,
  onCancel,
}: {
  onAdd: (source: TicketSource, externalId: string, relationship: TicketRelationship) => void;
  onCancel: () => void;
}) {
  const [source, setSource] = useState<TicketSource>('jira');
  const [externalId, setExternalId] = useState('');
  const [relationship, setRelationship] = useState<TicketRelationship>('related');

  return (
    <div className="mb-3 space-y-2 p-2 bg-gray-800/50 rounded">
      <div className="flex gap-2">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as TicketSource)}
          className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs"
        >
          <option value="jira">Jira</option>
          <option value="linear">Linear</option>
          <option value="github">GitHub</option>
        </select>
        <input
          value={externalId}
          onChange={(e) => setExternalId(e.target.value)}
          placeholder="PROJ-123"
          className="flex-1 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs font-mono"
          autoFocus
        />
      </div>
      <select
        value={relationship}
        onChange={(e) => setRelationship(e.target.value as TicketRelationship)}
        className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs"
      >
        <option value="primary">Primary</option>
        <option value="related">Related</option>
        <option value="blocked-by">Blocked By</option>
      </select>
      <div className="flex gap-2">
        <button
          onClick={() => externalId.trim() && onAdd(source, externalId.trim(), relationship)}
          className="text-xs text-blue-400"
        >
          Link
        </button>
        <button onClick={onCancel} className="text-xs text-gray-500">
          Cancel
        </button>
      </div>
    </div>
  );
}
