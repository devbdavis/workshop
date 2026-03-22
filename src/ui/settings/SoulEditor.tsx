import { useEffect, useState, useCallback } from 'react';

interface SoulState {
  content: string;
  source: 'user' | 'default' | 'none';
  userPath: string;
  defaultPath: string;
}

interface Message {
  type: 'success' | 'error';
  text: string;
}

export function SoulEditor() {
  const [soulState, setSoulState] = useState<SoulState | null>(null);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const isDirty = content !== savedContent;

  const loadSoul = useCallback(async () => {
    try {
      const res = await fetch('/api/soul');
      if (res.ok) {
        const data: SoulState = await res.json();
        setSoulState(data);
        setContent(data.content);
        setSavedContent(data.content);
      } else {
        showMessage('error', 'Failed to load soul configuration');
      }
    } catch (err) {
      console.error('Failed to load soul:', err);
      showMessage('error', 'Failed to load soul configuration');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSoul();
  }, [loadSoul]);

  function showMessage(type: Message['type'], text: string) {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/soul', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        const data: SoulState = await res.json();
        setSoulState(data);
        setSavedContent(content);
        showMessage('success', 'Soul saved successfully');
      } else {
        showMessage('error', 'Failed to save soul');
      }
    } catch (err) {
      console.error('Failed to save soul:', err);
      showMessage('error', 'Failed to save soul');
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!window.confirm('Reset to default soul? This will delete your custom override.')) {
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/soul', { method: 'DELETE' });
      if (res.ok) {
        const data: SoulState = await res.json();
        setSoulState(data);
        setContent(data.content);
        setSavedContent(data.content);
        showMessage('success', 'Reset to default soul');
      } else {
        showMessage('error', 'Failed to reset soul');
      }
    } catch (err) {
      console.error('Failed to reset soul:', err);
      showMessage('error', 'Failed to reset soul');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-500">Loading soul configuration...</p>;
  }

  const sourceBadge = {
    user: { label: 'user override', className: 'bg-blue-900/60 text-blue-300' },
    default: { label: 'default', className: 'bg-gray-700 text-gray-300' },
    none: { label: 'none', className: 'bg-amber-900/60 text-amber-300' },
  };

  const currentSource = soulState?.source ?? 'none';
  const badge = sourceBadge[currentSource];
  const displayPath = currentSource === 'user'
    ? soulState?.userPath
    : currentSource === 'default'
      ? soulState?.defaultPath
      : soulState?.userPath;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Soul</h2>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${badge.className}`}>
              {badge.label}
            </span>
          </div>
          <p className="text-sm text-gray-400 mt-1">
            Defines the personality and behavior of all AI agent sessions.
          </p>
        </div>
        <div className="flex gap-2">
          {currentSource === 'user' && (
            <button
              onClick={handleReset}
              disabled={saving}
              className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg transition-colors"
            >
              Reset to Default
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* File path display */}
      {displayPath && (
        <p className="text-xs text-gray-500 font-mono truncate">
          {displayPath}
        </p>
      )}

      {/* Message toast */}
      {message && (
        <div
          className={`px-3 py-2 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-green-900/50 text-green-300 border border-green-800'
              : 'bg-red-900/50 text-red-300 border border-red-800'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* No soul state */}
      {currentSource === 'none' ? (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 text-center">
          <p className="text-sm text-gray-400">
            No soul file found. Create one to define agent personality.
          </p>
          <p className="text-xs text-gray-500 mt-2">
            Edit the content below and save to create your custom soul.
          </p>
        </div>
      ) : null}

      {/* Editor textarea */}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="# Soul&#10;&#10;Define the personality and behavior of AI agents..."
        className="block w-full min-h-[300px] px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 font-mono focus:outline-none focus:border-blue-500 resize-y"
        spellCheck={false}
      />

      {/* Dirty indicator */}
      {isDirty && (
        <p className="text-xs text-amber-400">
          You have unsaved changes.
        </p>
      )}
    </div>
  );
}
