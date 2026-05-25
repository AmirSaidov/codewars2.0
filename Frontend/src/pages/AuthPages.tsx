// pages/LoginPage.tsx
import React, { useState } from 'react';
import type { Page } from '../App';
import type { User } from '../context/contexts';
import { authApi } from '../api';

interface Props {
  navigate: (p: Page) => void;
  onLogin: (u: User) => void;
}

export const LoginPage: React.FC<Props> = ({ navigate, onLogin }) => {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!form.username || !form.password) { setError('Fill all fields'); return; }
    setLoading(true); setError('');
    try {
      const res = await authApi.login(form);
      localStorage.setItem('cz_token', res.access);
      localStorage.setItem('cz_refresh', res.refresh);
      onLogin({ ...res.user, token: res.access });
    } catch (e: any) {
      setError(e.message || 'Invalid credentials');
    } finally { setLoading(false); }
  };

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <nav className="navbar">
        <div className="container" style={{ display: 'flex', alignItems: 'center', height: 64 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('landing')}>← BACK</button>
        </div>
      </nav>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 420 }} className="fade-in">
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 900, letterSpacing: 6, color: 'var(--accent)', marginBottom: 8 }}>
              SIGN IN
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Access the battlefield</p>
          </div>

          <div className="card card-glow">
            <div className="form-group">
              <label className="label">Username</label>
              <input
                className="input"
                placeholder="your_codename"
                value={form.username}
                onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
            </div>
            <div className="form-group">
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                placeholder="••••••••"
                value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
            </div>
            {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleSubmit} disabled={loading}>
              {loading ? 'AUTHENTICATING...' : 'ENTER THE ZONE'}
            </button>
          </div>

          <p style={{ textAlign: 'center', marginTop: 20, color: 'var(--text-secondary)', fontSize: 14 }}>
            No account?{' '}
            <button
              onClick={() => navigate('register')}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 14 }}>
              Register now
            </button>
          </p>

          {/* Demo hint */}
          <div style={{ marginTop: 24, padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 2, fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-code)' }}>
            <div style={{ marginBottom: 4, color: 'var(--accent)', letterSpacing: 2, fontSize: 10, fontFamily: 'var(--font-display)' }}>DEMO ACCOUNT</div>
            username: demo_player<br />password: demo1234
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;

// ─────────────────────────────────────────────────────────────────
// pages/RegisterPage.tsx
// ─────────────────────────────────────────────────────────────────
export const RegisterPage: React.FC<Props> = ({ navigate, onLogin }) => {
  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!form.username || !form.email || !form.password) { setError('Fill all fields'); return; }
    if (form.password !== form.confirm) { setError('Passwords do not match'); return; }
    if (form.password.length < 6) { setError('Password min 6 characters'); return; }
    setLoading(true); setError('');
    try {
      const res = await authApi.register({ username: form.username, email: form.email, password: form.password });
      localStorage.setItem('cz_token', res.access);
      localStorage.setItem('cz_refresh', res.refresh);
      onLogin({ ...res.user, token: res.access });
    } catch (e: any) {
      setError(e.message || 'Registration failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <nav className="navbar">
        <div className="container" style={{ display: 'flex', alignItems: 'center', height: 64 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('landing')}>← BACK</button>
        </div>
      </nav>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 420 }} className="fade-in">
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 900, letterSpacing: 6, color: 'var(--accent)', marginBottom: 8 }}>
              REGISTER
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Create your operative profile</p>
          </div>

          <div className="card card-glow">
            {[
              { key: 'username', label: 'Username', placeholder: 'your_codename', type: 'text' },
              { key: 'email', label: 'Email', placeholder: 'operative@zone.com', type: 'email' },
              { key: 'password', label: 'Password', placeholder: '••••••••', type: 'password' },
              { key: 'confirm', label: 'Confirm Password', placeholder: '••••••••', type: 'password' },
            ].map(field => (
              <div key={field.key} className="form-group">
                <label className="label">{field.label}</label>
                <input
                  className="input"
                  type={field.type}
                  placeholder={field.placeholder}
                  value={(form as any)[field.key]}
                  onChange={e => setForm(p => ({ ...p, [field.key]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                />
              </div>
            ))}
            {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleSubmit} disabled={loading}>
              {loading ? 'CREATING PROFILE...' : 'JOIN THE ZONE'}
            </button>
          </div>

          <p style={{ textAlign: 'center', marginTop: 20, color: 'var(--text-secondary)', fontSize: 14 }}>
            Already registered?{' '}
            <button
              onClick={() => navigate('login')}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 14 }}>
              Sign in
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};
