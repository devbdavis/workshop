import { useState } from 'react';
import type { PermissionRequest } from '@foundation/types';

interface Props {
  requests: PermissionRequest[];
  onResolve: (id: string, decision: 'approved' | 'denied', comment?: string) => void;
  onAllowAllForSession: (sessionId: string) => void;
}

export function PermissionPanel({ requests, onResolve, onAllowAllForSession }: Props) {
  if (requests.length === 0) return null;

  // Group by session to show per-session "Allow All" buttons
  const sessionIds = [...new Set(requests.map((r) => r.sessionId))];

  return (
    <div className="border-b border-amber-800/50 bg-amber-950/30">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-amber-800/30">
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-xs font-semibold text-amber-300">
          {requests.length} pending approval{requests.length > 1 ? 's' : ''}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {sessionIds.map((sid) => (
            <button
              key={sid}
              onClick={() => onAllowAllForSession(sid)}
              className="px-2 py-0.5 text-[11px] bg-amber-800/60 hover:bg-amber-700/60 text-amber-200 rounded transition-colors"
              title={`Auto-approve all tool use for session ${sid.slice(0, 8)} going forward`}
            >
              Allow all{sessionIds.length > 1 ? ` (${sid.slice(0, 8)})` : ''}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {requests.map((req) => (
          <PermissionCard key={req.id} request={req} onResolve={onResolve} />
        ))}
      </div>
    </div>
  );
}

function PermissionCard({
  request,
  onResolve,
}: {
  request: PermissionRequest;
  onResolve: (id: string, decision: 'approved' | 'denied', comment?: string) => void;
}) {
  const [comment, setComment] = useState('');
  const [showComment, setShowComment] = useState(false);

  const toolDisplay = formatToolDisplay(request.toolName, request.toolInput);

  return (
    <div className="px-3 py-2 border-b border-gray-800/50 last:border-b-0">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-xs font-semibold text-amber-300">{request.toolName}</span>
            <span className="text-[10px] text-gray-500 font-mono">
              {request.id.slice(0, 8)}
            </span>
          </div>
          <pre className="text-xs text-gray-300 bg-gray-900/80 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-32 overflow-y-auto font-mono">
            {toolDisplay}
          </pre>
        </div>
      </div>

      {showComment && (
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Optional comment for the agent..."
          className="w-full mt-2 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-gray-300"
          rows={2}
          autoFocus
        />
      )}

      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={() => onResolve(request.id, 'approved', comment || undefined)}
          className="px-2.5 py-1 text-xs bg-green-800 hover:bg-green-700 text-green-200 rounded transition-colors"
        >
          Approve
        </button>
        <button
          onClick={() => onResolve(request.id, 'denied', comment || undefined)}
          className="px-2.5 py-1 text-xs bg-red-900 hover:bg-red-800 text-red-200 rounded transition-colors"
        >
          Deny
        </button>
        <button
          onClick={() => setShowComment(!showComment)}
          className="px-2.5 py-1 text-xs text-gray-400 hover:text-gray-200 transition-colors"
        >
          {showComment ? 'Hide comment' : 'Comment'}
        </button>
      </div>
    </div>
  );
}

/** Format tool input for display — show the most relevant part */
function formatToolDisplay(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'Bash' && input.command) {
    return String(input.command);
  }
  if ((toolName === 'Edit' || toolName === 'Write') && input.file_path) {
    const filePath = String(input.file_path);
    if (toolName === 'Write') {
      const content = String(input.content || '').slice(0, 200);
      return `${filePath}\n\n${content}${String(input.content || '').length > 200 ? '...' : ''}`;
    }
    const oldStr = String(input.old_string || '').slice(0, 100);
    const newStr = String(input.new_string || '').slice(0, 100);
    return `${filePath}\n- ${oldStr}\n+ ${newStr}`;
  }
  return JSON.stringify(input, null, 2);
}
