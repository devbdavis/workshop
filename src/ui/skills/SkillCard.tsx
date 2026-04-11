import { useState } from 'react';
import type { Skill } from '@foundation/types';
import { DiffModal } from '@ui/shared/DiffModal.js';

interface Props {
  skill: Skill;
  onEdit: () => void;
  onDelete: () => void;
  onImprove: () => void;
  onSyncFromTemplate?: () => void;
}

const SOURCE_STYLES: Record<Skill['source'], string> = {
  global: 'bg-gray-700 text-gray-300',
  project: 'bg-blue-900 text-blue-300',
};

const SOURCE_LABELS: Record<Skill['source'], string> = {
  global: 'Global',
  project: 'Project',
};

export function SkillCard({ skill, onEdit, onDelete, onImprove, onSyncFromTemplate }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const isEditable = skill.source === 'global';

  const contentPreview =
    skill.content.length > 100 ? skill.content.slice(0, 100) + '...' : skill.content;

  return (
    <>
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-200">{skill.name}</h3>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${SOURCE_STYLES[skill.source]}`}>
              {SOURCE_LABELS[skill.source]}
            </span>
            {skill.isOutOfSync && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-300">
                out of sync
              </span>
            )}
          </div>
          {skill.isOutOfSync && onSyncFromTemplate && (
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={() => setShowDiff(true)}
                className="text-[10px] text-amber-400 hover:text-amber-300 underline"
              >
                View diff
              </button>
              <span className="text-[10px] text-gray-600">·</span>
              <button
                onClick={onSyncFromTemplate}
                className="text-[10px] text-amber-400 hover:text-amber-300 underline"
              >
                Update to latest
              </button>
            </div>
          )}
          {skill.description && (
            <p className="text-xs text-gray-400 mt-1">{skill.description}</p>
          )}
          {skill.filePath && (
            <p className="text-[10px] text-gray-500 mt-1 font-mono">{skill.filePath}</p>
          )}
        </div>
        <div className="flex items-center gap-2 ml-3 shrink-0">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            {expanded ? 'Collapse' : 'Preview'}
          </button>
          {isEditable && (
            <>
              <button onClick={onImprove} className="text-xs text-gray-400 hover:text-blue-300">
                Improve
              </button>
              <button onClick={onEdit} className="text-xs text-blue-400 hover:text-blue-300">
                Edit
              </button>
              <button onClick={onDelete} className="text-xs text-red-500 hover:text-red-400">
                Delete
              </button>
            </>
          )}
        </div>
      </div>
      {!expanded && (
        <p className="text-xs text-gray-500 mt-2 line-clamp-2">{contentPreview}</p>
      )}
      {expanded && (
        <pre className="mt-3 p-3 bg-gray-900 rounded text-xs text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-60 overflow-y-auto">
          {skill.content}
        </pre>
      )}
    </div>

    {showDiff && skill.templateContent && (
      <DiffModal
        title={`Diff — ${skill.name}`}
        beforeLabel="Template"
        afterLabel="Yours"
        before={skill.templateContent}
        after={skill.content}
        onClose={() => setShowDiff(false)}
      />
    )}
    </>
  );
}
