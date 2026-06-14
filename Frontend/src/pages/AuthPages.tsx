// pages/LoginPage.tsx
import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { Page } from '../App';
import type { User } from '../context/contexts';
import { authApi } from '../api';

interface Props {
  navigate: (p: Page) => void;
  onLogin: (u: User) => void;
}

type PasswordFieldProps = {
  label: string;
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
  onEnter: () => void;
};

const PasswordField: React.FC<PasswordFieldProps> = ({ label, value, placeholder, onChange, onEnter }) => {
  const [show, setShow] = useState(false);
  const visible = show;

  return (
    <div className="form-group">
      <label className="label">{label}</label>
      <div className="password-field">
        <input
          className="input password-input"
          type={visible ? 'text' : 'password'}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onEnter()}
        />
        <button
          type="button"
          className="password-peek"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={show}
          onClick={() => setShow((v) => !v)}
        >
          <span className="password-peek-icon" aria-hidden="true">
            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </span>
        </button>
      </div>
    </div>
  );
};

export const LoginPage: React.FC<Props> = ({ navigate, onLogin }) => {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!form.email || !form.password) { setError('Fill all fields'); return; }
    setLoading(true); setError('');
    try {
      const res = await authApi.login(form);
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
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                placeholder="operative@zone.com"
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
            </div>

            <PasswordField
              label="Password"
              placeholder="••••••••"
              value={form.password}
              onChange={(password) => setForm((p) => ({ ...p, password }))}
              onEnter={handleSubmit}
            />

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

          <div style={{ marginTop: 24, padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 2, fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-code)' }}>
            Sign in using the email you registered with.
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;

// pages/RegisterPage.tsx
export const RegisterPage: React.FC<Props> = ({ navigate, onLogin }) => {
  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!form.username || !form.email || !form.password) { setError('Fill all fields'); return; }
    if (form.password !== form.confirm) { setError('Passwords do not match'); return; }
    if (form.password.length < 8) { setError('Password min 8 characters'); return; }
    setLoading(true); setError('');
    try {
      const res = await authApi.register({ username: form.username, email: form.email, password: form.password });
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
            <div className="form-group">
              <label className="label">Username</label>
              <input
                className="input"
                type="text"
                placeholder="your_codename"
                value={form.username}
                onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
            </div>
            <div className="form-group">
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                placeholder="operative@zone.com"
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
            </div>

            <PasswordField
              label="Password"
              placeholder="••••••••"
              value={form.password}
              onChange={(password) => setForm((p) => ({ ...p, password }))}
              onEnter={handleSubmit}
            />

            <PasswordField
              label="Confirm Password"
              placeholder="••••••••"
              value={form.confirm}
              onChange={(confirm) => setForm((p) => ({ ...p, confirm }))}
              onEnter={handleSubmit}
            />

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
