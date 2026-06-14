import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ImagePlus, Save, Trash2 } from 'lucide-react';
import type { Page } from '../App';
import { authApi } from '../api';
import { useAuth } from '../context/contexts';

interface Props {
  navigate: (p: Page, roomId?: string | number) => void;
}

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });

const ProfilePage: React.FC<Props> = ({ navigate }) => {
  const { user, updateUser, logout } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState({
    username: user?.username || '',
    email: user?.email || '',
    first_name: user?.first_name || '',
    last_name: user?.last_name || '',
    bio: user?.bio || '',
    avatar: user?.avatar || '',
  });
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

  if (!user?.token) return null;

  const persistLocalProfile = () => {
    const localUser = {
      ...user,
      username: form.username.trim(),
      email: form.email.trim(),
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      bio: form.bio,
      avatar: form.avatar,
      token: user.token,
    };
    updateUser(localUser);
    return localUser;
  };

  const onPickAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file for avatar');
      return;
    }
    if (file.size > 1_500_000) {
      setError('Avatar is too large. Keep it under 1.5 MB');
      return;
    }
    setError('');
    const dataUrl = await readFileAsDataUrl(file);
    setForm((current) => ({ ...current, avatar: dataUrl }));
  };

  const handleSave = async () => {
    if (!form.username.trim() || !form.email.trim()) {
      setError('Username and email are required');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    const localUser = persistLocalProfile();
    try {
      const updated = await authApi.updateMe({
        username: form.username.trim(),
        email: form.email.trim(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        bio: form.bio,
        avatar: form.avatar,
      });
      updateUser({ ...localUser, ...updated, token: user.token });
      setForm({
        username: updated.username,
        email: updated.email,
        first_name: updated.first_name || '',
        last_name: updated.last_name || '',
        bio: updated.bio || '',
        avatar: updated.avatar || '',
      });
      setSuccess('Profile saved');
    } catch (saveError: any) {
      setSuccess('Profile saved locally');
      setError(saveError?.message || 'Server save failed, local profile kept');
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

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={onPickAvatar}
            />

            <button className="btn btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <ImagePlus size={14} /> CHANGE AVATAR
              </span>
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
