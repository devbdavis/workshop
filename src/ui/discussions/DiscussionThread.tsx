import { useState, useRef, useEffect } from 'react';
import type {
  DiscussionStatus,
  DiscussionMessageType,
  DiscussionVoteValue,
} from '@foundation/discussion-types';
import type { DiscussionState } from '@application/discussion/discussion-service';

interface DiscussionThreadProps {
  state: DiscussionState;
  onPostMessage: (data: { messageType: string; content: string }) => void;
  onCastVote: (data: { vote: string; comment?: string }) => void;
  onClose: () => void;
  onAct?: () => void;
  acting?: boolean;
}

const STATUS_STYLES: Record<DiscussionStatus, string> = {
  open: 'bg-blue-900/60 text-blue-300',
  consensus: 'bg-green-900/60 text-green-300',
  closed: 'bg-gray-700 text-gray-400',
  stale: 'bg-yellow-900/60 text-yellow-300',
  failed: 'bg-red-900/60 text-red-300',
};

const TYPE_STYLES: Record<string, string> = {
  rfc: 'bg-indigo-900/60 text-indigo-300',
  question: 'bg-cyan-900/60 text-cyan-300',
  review: 'bg-amber-900/60 text-amber-300',
};

const MSG_STYLES: Record<DiscussionMessageType, string> = {
  proposal: 'bg-indigo-900/60 text-indigo-300',
  comment: 'bg-gray-700 text-gray-300',
  suggestion: 'bg-cyan-900/60 text-cyan-300',
  objection: 'bg-red-900/60 text-red-300',
  revision: 'bg-amber-900/60 text-amber-300',
  satisfied: 'bg-green-900/60 text-green-300',
  unsatisfied: 'bg-red-900/60 text-red-300',
};

const MSG_BORDER: Record<DiscussionMessageType, string> = {
  proposal: 'border-indigo-500',
  comment: 'border-gray-600',
  suggestion: 'border-cyan-500',
  objection: 'border-red-500',
  revision: 'border-amber-500',
  satisfied: 'border-green-500',
  unsatisfied: 'border-red-500',
};

const VOTE_COLORS: Record<DiscussionVoteValue, string> = {
  satisfied: 'bg-green-600',
  unsatisfied: 'bg-red-600',
  abstain: 'bg-yellow-600',
};

const HUMAN_MSG_TYPES: { value: DiscussionMessageType; label: string }[] = [
  { value: 'comment', label: 'Comment' },
  { value: 'suggestion', label: 'Suggestion' },
  { value: 'objection', label: 'Objection' },
  { value: 'revision', label: 'Revision' },
];

const STATUS_BANNER: Partial<Record<DiscussionStatus, { text: string; style: string }>> = {
  consensus: { text: 'Consensus reached', style: 'bg-green-900/40 text-green-300 border-green-800' },
  closed: { text: 'Discussion closed', style: 'bg-gray-800 text-gray-400 border-gray-700' },
  stale: { text: 'Discussion went stale', style: 'bg-yellow-900/40 text-yellow-300 border-yellow-800' },
  failed: { text: 'Discussion failed', style: 'bg-red-900/40 text-red-300 border-red-800' },
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function DiscussionThread({ state, onPostMessage, onCastVote, onClose, onAct, acting }: DiscussionThreadProps) {
  const { discussion, messages, votes, consensusMet, participantCount, votedCount, satisfiedCount } = state;
  const isOpen = discussion.status === 'open';

  const [msgType, setMsgType] = useState<DiscussionMessageType>('comment');
  const [content, setContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  function handlePost() {
    const trimmed = content.trim();
    if (!trimmed) return;
    onPostMessage({ messageType: msgType, content: trimmed });
    setContent('');
  }

  function handleVote(vote: DiscussionVoteValue) {
    onCastVote({ vote });
  }

  // Build participant vote map for the vote status bar
  const voteByParticipant = new Map<string, DiscussionVoteValue>();
  for (const v of votes) {
    voteByParticipant.set(v.voterId, v.vote);
  }

  const banner = STATUS_BANNER[discussion.status];

  // Show "Act on Consensus" for human-started discussions that reached a conclusion
  const canAct =
    discussion.createdByType === 'human' &&
    (discussion.status === 'consensus' || discussion.status === 'closed');

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-gray-800 bg-gray-950">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-sm font-semibold text-gray-100 flex-1 truncate">{discussion.title}</h2>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${TYPE_STYLES[discussion.type] ?? 'bg-gray-700 text-gray-400'}`}>
            {discussion.type}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLES[discussion.status]}`}>
            {discussion.status}
          </span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg ml-2">&times;</button>
        </div>

        {/* Vote tally */}
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>{satisfiedCount}/{participantCount} satisfied</span>
          <span className="text-gray-600">|</span>
          <span>{votedCount} voted</span>
          {consensusMet && (
            <span className="text-green-400 font-medium ml-1">Consensus</span>
          )}
        </div>
      </div>

      {/* Vote status bar */}
      <div className="shrink-0 px-4 py-2 border-b border-gray-800 flex items-center gap-1.5 flex-wrap">
        {discussion.participantIds.map((pid) => {
          const vote = voteByParticipant.get(pid);
          const color = vote ? VOTE_COLORS[vote] : 'bg-gray-600';
          const name = votes.find((v) => v.voterId === pid)?.voterName ?? pid;
          return (
            <span
              key={pid}
              title={`${name}: ${vote ?? 'pending'}`}
              className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${
                vote === 'satisfied' ? 'bg-green-900/50 text-green-300'
                : vote === 'unsatisfied' ? 'bg-red-900/50 text-red-300'
                : vote === 'abstain' ? 'bg-yellow-900/50 text-yellow-300'
                : 'bg-gray-800 text-gray-500'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
              {name}
            </span>
          );
        })}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`bg-gray-900/50 border-l-2 ${MSG_BORDER[msg.messageType]} rounded-r px-3 py-2`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-gray-200">
                {msg.authorName ?? msg.authorId ?? 'Unknown'}
              </span>
              <span className={`text-[10px] px-1 py-0.5 rounded ${
                msg.authorType === 'human' ? 'bg-purple-900/50 text-purple-300' : 'bg-gray-800 text-gray-400'
              }`}>
                {msg.authorType}
              </span>
              <span className={`text-[10px] px-1 py-0.5 rounded ${MSG_STYLES[msg.messageType]}`}>
                {msg.messageType}
              </span>
              <span className="text-[10px] text-gray-500 ml-auto">
                {formatRelativeTime(msg.createdAt)}
              </span>
            </div>
            <p className="text-sm text-gray-300 whitespace-pre-wrap">{msg.content}</p>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area or status banner */}
      {isOpen ? (
        <div className="shrink-0 px-4 py-3 border-t border-gray-800 bg-gray-950 space-y-2">
          <div className="flex items-center gap-2">
            <select
              value={msgType}
              onChange={(e) => setMsgType(e.target.value as DiscussionMessageType)}
              className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300"
            >
              {HUMAN_MSG_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write a message..."
              rows={2}
              className="flex-1 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-600 resize-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handlePost();
              }}
            />
            <button
              onClick={handlePost}
              disabled={!content.trim()}
              className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-40"
            >
              Post
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500 mr-1">Vote:</span>
            <button
              onClick={() => handleVote('satisfied')}
              className="px-3 py-1 text-xs bg-green-800 hover:bg-green-700 text-green-200 rounded transition-colors"
            >
              Satisfied
            </button>
            <button
              onClick={() => handleVote('unsatisfied')}
              className="px-3 py-1 text-xs bg-red-900 hover:bg-red-800 text-red-200 rounded transition-colors"
            >
              Unsatisfied
            </button>
            <button
              onClick={() => handleVote('abstain')}
              className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
            >
              Abstain
            </button>
          </div>
        </div>
      ) : banner ? (
        <div className={`shrink-0 px-4 py-3 border-t ${banner.style}`}>
          <div className="flex items-center justify-center gap-3">
            <span className="text-sm font-medium">{banner.text}</span>
            {canAct && onAct && (
              <button
                onClick={onAct}
                disabled={acting}
                className="px-3 py-1 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-colors disabled:opacity-50"
              >
                {acting ? 'Dispatching...' : 'Act on Consensus'}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
