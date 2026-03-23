import { useState, type FormEvent } from 'react';

interface LoginPageProps {
  onLogin: () => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });

      if (res.ok) {
        onLogin();
      } else {
        setError('Invalid token');
      }
    } catch {
      setError('Could not reach the Workshop server');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm mx-auto">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-8">
          <h1 className="text-xl font-semibold text-gray-100 mb-1">Workshop</h1>
          <p className="text-sm text-gray-400 mb-6">
            Paste the token from <code className="text-gray-300 bg-gray-800 px-1.5 py-0.5 rounded text-xs">~/.workshop/auth-token</code>
          </p>

          <form onSubmit={handleSubmit}>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Auth token"
              autoFocus
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-3 font-mono"
            />

            {error && (
              <p className="text-red-400 text-sm mb-3">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !token.trim()}
              className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded transition-colors"
            >
              {loading ? 'Authenticating...' : 'Login'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
