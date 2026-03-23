import { useEffect, useState, type ReactNode } from 'react';
import { LoginPage } from './LoginPage';

interface AuthGateProps {
  children: ReactNode;
}

type AuthState = 'loading' | 'authenticated' | 'unauthenticated';

export function AuthGate({ children }: AuthGateProps) {
  const [state, setState] = useState<AuthState>('loading');

  function checkAuth() {
    fetch('/api/auth/status')
      .then((res) => res.json())
      .then((data: { authenticated: boolean }) => {
        setState(data.authenticated ? 'authenticated' : 'unauthenticated');
      })
      .catch(() => {
        setState('unauthenticated');
      });
  }

  useEffect(() => {
    checkAuth();
  }, []);

  if (state === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-950">
        <p className="text-gray-500 text-sm">Connecting...</p>
      </div>
    );
  }

  if (state === 'unauthenticated') {
    return <LoginPage onLogin={checkAuth} />;
  }

  return <>{children}</>;
}
