import { NavLink, useMatch } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Tracks', end: true },
  { to: '/kanban', label: 'Kanban', end: false },
  { to: '/agents', label: 'Agents', end: false },
  { to: '/settings', label: 'Settings', end: false },
];

export function TopNav() {
  const trackMatch = useMatch('/tracks/:trackId');

  return (
    <nav className="flex items-center gap-1 px-4 py-1.5 bg-gray-950 border-b border-gray-800 shrink-0">
      <NavLink
        to="/"
        className="text-sm font-semibold text-gray-300 hover:text-white mr-4 tracking-tight"
      >
        Workshop
      </NavLink>

      <div className="flex items-center gap-0.5">
        {navItems.map(({ to, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `px-3 py-1 text-xs font-medium rounded transition-colors ${
                isActive
                  ? 'bg-gray-800 text-gray-100'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900'
              }`
            }
          >
            {label}
          </NavLink>
        ))}

        {/* Show a track breadcrumb pill when inside a track view */}
        {trackMatch && (
          <span className="ml-1 px-2 py-0.5 text-[10px] font-mono text-gray-500 bg-gray-900 rounded">
            /{trackMatch.params.trackId?.slice(0, 8)}
          </span>
        )}
      </div>
    </nav>
  );
}
