import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import type { Page } from '../App';
import { authApi } from '../api';
import type { UserProfile } from '../api';
import { useAuth } from '../context/contexts';

interface Props {
  navigate: (p: Page, roomId?: string | number) => void;
}

const getProfileValue = (user: UserProfile | null | undefined, key: 'avatar' | 'bio' | 'display_name') =>
  user?.profile?.[key] || user?.[key] || '';

const buildProfileForm = (user: UserProfile | null | undefined) => ({
  username: user?.username || '',
  email: user?.email || '',
  first_name: user?.first_name || '',
  last_name: user?.last_name || '',
  display_name: getProfileValue(user, 'display_name'),
  bio: getProfileValue(user, 'bio'),
  avatar: getProfileValue(user, 'avatar'),
});

const isValidAvatarUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return true;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const ProfilePage: React.FC<Props> = ({ navigate }) => {
  const { user, updateUser, logout } = useAuth();
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState(() => buildProfileForm(user as UserProfile | null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const initials = useMemo(() => {
    const seed = form.username.trim() || user?.username || 'U';
    return seed.slice(0, 1).toUpperCase();
  }, [form.username, user?.username]);

  useEffect(() => {
    if (!user?.token) logout();
  }, [logout, user?.token]);

  useEffect(() => {
    if (!user?.token) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    authApi.me()
      .then((freshUser) => {
        if (cancelled) return;
        const nextUser = { ...freshUser, token: user.token };
        updateUser(nextUser);
        setForm(buildProfileForm(nextUser));
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load profile');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.token]);

  if (!user?.token) return null;

  const handleSave = async () => {
    if (!form.username.trim() || !form.email.trim()) {
      setError('Username and email are required');
      return;
    }
    if (!isValidAvatarUrl(form.avatar)) {
      setError('Avatar must be a valid http(s) URL');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const updated = await authApi.updateMe({
        username: form.username.trim(),
        email: form.email.trim(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        profile: {
          display_name: form.display_name.trim(),
          bio: form.bio,
          avatar: form.avatar.trim(),
        },
      });
      const nextUser = { ...updated, token: user.token };
      updateUser(nextUser);
      setForm(buildProfileForm(nextUser));
      setSuccess('Profile saved');
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <nav className="navbar">
        <div className="container mobile-nav" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('dashboard')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <ArrowLeft size={14} /> BACK
            </span>
          </button>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, letterSpacing: 3 }}>OPERATIVE PROFILE</span>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Save size={14} /> {saving ? 'SAVING...' : 'SAVE'}
            </span>
          </button>
        </div>
      </nav>

      <div className="container profile-shell" style={{ paddingTop: 40, paddingBottom: 40, display: 'grid', gap: 24 }}>
        <div className="card card-glow profile-card-grid" style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 24 }}>
          {loading && (
            <div style={{ gridColumn: '1 / -1', color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', letterSpacing: 2 }}>
              LOADING PROFILE...
            </div>
          )}
          <div style={{ display: 'grid', justifyItems: 'center', alignContent: 'start', gap: 16 }}>
            <div
              style={{
                width: 144,
                height: 144,
                borderRadius: 12,
                overflow: 'hidden',
                border: '1px solid var(--border)',
                background: 'var(--bg-secondary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'var(--font-display)',
                fontSize: 48,
                fontWeight: 900,
                color: 'var(--accent)',
              }}
            >
              {form.avatar ? (
                <img src={form.avatar} alt="Avatar preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                initials
              )}
            </div>

            <button className="btn btn-ghost btn-sm" onClick={() => avatarInputRef.current?.focus()}>
              AVATAR URL
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setForm((current) => ({ ...current, avatar: '' }))}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Trash2 size={14} /> REMOVE
              </span>
            </button>
          </div>

          <div style={{ display: 'grid', gap: 16 }}>
            <div>
              <div className="section-label" style={{ marginBottom: 8 }}>IDENTITY</div>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 900, letterSpacing: 4 }}>
                {form.username || 'OPERATIVE'}
              </h1>
            </div>

            <div className="profile-field-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="form-group">
                <label className="label">Username</label>
                <input className="input" value={form.username} onChange={(e) => setForm((current) => ({ ...current, username: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="label">Email</label>
                <input className="input" type="email" value={form.email} onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))} />
              </div>
            </div>

            <div className="profile-field-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="form-group">
                <label className="label">First name</label>
                <input className="input" value={form.first_name} onChange={(e) => setForm((current) => ({ ...current, first_name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="label">Last name</label>
                <input className="input" value={form.last_name} onChange={(e) => setForm((current) => ({ ...current, last_name: e.target.value }))} />
              </div>
            </div>

            <div className="profile-field-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="form-group">
                <label className="label">Display name</label>
                <input className="input" value={form.display_name} onChange={(e) => setForm((current) => ({ ...current, display_name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="label">Avatar URL</label>
                <input
                  ref={avatarInputRef}
                  className="input"
                  value={form.avatar}
                  onChange={(e) => setForm((current) => ({ ...current, avatar: e.target.value }))}
                  placeholder="https://example.com/avatar.png"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="label">Bio</label>
              <textarea
                className="input"
                rows={5}
                value={form.bio}
                onChange={(e) => setForm((current) => ({ ...current, bio: e.target.value }))}
                style={{ minHeight: 140, resize: 'vertical', whiteSpace: 'pre-wrap' }}
                placeholder="Tell the zone who you are..."
              />
            </div>

            {error && <div className="form-error">{error}</div>}
            {success && <div style={{ color: 'var(--accent)', fontFamily: 'var(--font-code)', fontSize: 12 }}>{success}</div>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
