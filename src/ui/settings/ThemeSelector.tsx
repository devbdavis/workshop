import { useTheme, THEMES, type ThemeId } from '@ui/hooks/useTheme';

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-200 mb-1">Appearance</h2>
      <p className="text-xs text-gray-500 mb-4">Select a color theme. Persisted locally in your browser.</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {THEMES.map((t) => (
          <ThemeCard
            key={t.id}
            id={t.id}
            name={t.name}
            description={t.description}
            preview={t.preview}
            selected={theme === t.id}
            onSelect={setTheme}
          />
        ))}
      </div>
    </div>
  );
}

interface ThemeCardProps {
  id: ThemeId;
  name: string;
  description: string;
  preview: { bg: string; surface: string; accent: string; text: string };
  selected: boolean;
  onSelect: (id: ThemeId) => void;
}

function ThemeCard({ id, name, description, preview, selected, onSelect }: ThemeCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className={[
        'relative rounded-lg border-2 overflow-hidden text-left transition-all',
        selected
          ? 'border-blue-500 ring-1 ring-blue-500/40'
          : 'border-gray-700 hover:border-gray-500',
      ].join(' ')}
    >
      {/* Preview swatch */}
      <div
        className="h-16 flex items-center justify-center gap-1.5 px-3"
        style={{ backgroundColor: preview.bg }}
      >
        {/* Surface chip */}
        <div
          className="rounded flex-1 h-8 flex items-end pb-1.5 px-2"
          style={{ backgroundColor: preview.surface }}
        >
          <div className="w-3/4 h-1.5 rounded-full" style={{ backgroundColor: preview.text, opacity: 0.7 }} />
        </div>
        {/* Accent chip */}
        <div
          className="rounded h-8 w-6"
          style={{ backgroundColor: preview.accent }}
        />
      </div>

      {/* Label */}
      <div className="px-3 py-2 bg-gray-900 border-t border-gray-800">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-200">{name}</span>
          {selected && (
            <span className="text-blue-400 text-xs">✓</span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
    </button>
  );
}
