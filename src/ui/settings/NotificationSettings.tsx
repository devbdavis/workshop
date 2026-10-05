import { useState } from 'react';
import { loadPrefs, savePrefs, playPing, type NotifyPrefs } from '../notifications/prefs';

function notificationStatus(): string | undefined {
  if (!('Notification' in window)) return 'Browser notifications are not supported in this browser.';
  if (!window.isSecureContext) return 'Browser notifications require HTTPS or localhost.';
  if (Notification.permission === 'denied') return 'Notifications are blocked — allow them in your browser\'s site settings.';
  return undefined;
}

export function NotificationSettings() {
  const [prefs, setPrefs] = useState<NotifyPrefs>(loadPrefs);

  function update(partial: Partial<NotifyPrefs>): void {
    const next = { ...prefs, ...partial };
    setPrefs(next);
    savePrefs(next);
  }

  function toggleSystem(checked: boolean): void {
    if (checked && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(() => update({ system: checked }));
      return;
    }
    update({ system: checked });
  }

  const status = notificationStatus();
  // System defaults on, but the browser only prompts from a gesture — offer it explicitly.
  const needsPermission = prefs.system && !status && Notification.permission === 'default';

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-200 mb-1">Session Notifications</h2>
      <p className="text-xs text-gray-500 mb-4">
        Alert me when a session needs input or goes idle after working.
      </p>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <input
            id="notify-system"
            type="checkbox"
            checked={prefs.system}
            onChange={(e) => toggleSystem(e.target.checked)}
            className="h-4 w-4 rounded border-gray-700 bg-gray-800"
          />
          <label htmlFor="notify-system" className="text-xs text-gray-300">System alert</label>
        </div>
        {status && <p className="text-xs text-amber-500 ml-7">{status}</p>}
        {needsPermission && (
          <button
            onClick={() => Notification.requestPermission().then(() => setPrefs({ ...prefs }))}
            className="ml-7 px-2 py-1 text-[11px] bg-blue-700 hover:bg-blue-600 rounded transition-colors text-white"
          >
            Allow browser notifications
          </button>
        )}

        <div className="flex items-center gap-3">
          <input
            id="notify-sound"
            type="checkbox"
            checked={prefs.sound}
            onChange={(e) => update({ sound: e.target.checked })}
            className="h-4 w-4 rounded border-gray-700 bg-gray-800"
          />
          <label htmlFor="notify-sound" className="text-xs text-gray-300">Sound</label>
        </div>

        <div className="flex items-center gap-3 ml-7">
          <input
            id="notify-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={prefs.volume}
            disabled={!prefs.sound}
            onChange={(e) => update({ volume: Number(e.target.value) })}
            className="w-40 disabled:opacity-40"
          />
          <button
            onClick={() => playPing(prefs.volume)}
            disabled={!prefs.sound}
            className="px-2 py-1 text-[11px] bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 rounded transition-colors text-gray-100"
          >
            Test
          </button>
        </div>

        <div className="flex items-center gap-3">
          <input
            id="notify-chip"
            type="checkbox"
            checked={prefs.chip}
            onChange={(e) => update({ chip: e.target.checked })}
            className="h-4 w-4 rounded border-gray-700 bg-gray-800"
          />
          <label htmlFor="notify-chip" className="text-xs text-gray-300">In-app chip</label>
        </div>

        <div className="flex items-center gap-3">
          <input
            id="notify-idle"
            type="checkbox"
            checked={prefs.idle}
            onChange={(e) => update({ idle: e.target.checked })}
            className="h-4 w-4 rounded border-gray-700 bg-gray-800"
          />
          <label htmlFor="notify-idle" className="text-xs text-gray-300">
            Also alert when a session goes idle after working
          </label>
        </div>
      </div>
    </div>
  );
}
