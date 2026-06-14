// pages/LandingPage.tsx
import React, { useEffect, useState } from 'react';
import type { Page } from '../App';
import { useTheme } from '../context/contexts';
import { BarChart3, Palette, Shield, Sword, Trophy, Zap } from 'lucide-react';

interface Props { navigate: (p: Page) => void; }

const features = [
  { title: 'Battle Arenas', desc: 'Real-time multiplayer coding battles up to 10 players' },
  { title: 'Survival Rounds', desc: 'Each round eliminates the slowest — last coder standing wins' },
  { title: 'Live Leaderboard', desc: 'Watch rankings shift in real-time as solutions get submitted' },
  { title: 'Admin Control', desc: 'Full room moderation with manual override capabilities' },
  { title: '4 Unique Themes', desc: 'STALKER, Cyberpunk, Hacker Terminal, and Minimal' },
  { title: 'Monaco Editor', desc: 'VS Code-grade editor with syntax highlighting & autocomplete' },
];

const GLITCH_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&';

const FeatureIcon: React.FC<{ title: string }> = ({ title }) => {
  const props = { size: 28, strokeWidth: 2.2 } as const;
  switch (title) {
    case 'Battle Arenas': return <Sword {...props} />;
    case 'Survival Rounds': return <Trophy {...props} />;
    case 'Live Leaderboard': return <BarChart3 {...props} />;
    case 'Admin Control': return <Shield {...props} />;
    case '4 Unique Themes': return <Palette {...props} />;
    case 'Monaco Editor': return <Zap {...props} />;
    default: return <Zap {...props} />;
  }
};

const useGlitch = (text: string, active: boolean) => {
  const [display, setDisplay] = useState(text);
  useEffect(() => {
    if (!active) { setDisplay(text); return; }
    let iter = 0;
    const interval = setInterval(() => {
      setDisplay(text.split('').map((c, i) => {
        if (i < iter) return text[i];
        if (c === ' ') return ' ';
        return GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
      }).join(''));
      if (iter >= text.length) clearInterval(interval);
      iter += 0.5;
    }, 30);
    return () => clearInterval(interval);
  }, [text, active]);
  return display;
};

const LandingPage: React.FC<Props> = ({ navigate }) => {
  const { theme } = useTheme();
  const [glitchActive, setGlitchActive] = useState(false);
  const titleText = useGlitch('CODE ZONE', glitchActive);

  useEffect(() => {
    const t = setTimeout(() => setGlitchActive(true), 500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* NAV */}
      <nav className="navbar">
        <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32,
              background: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 900,
              color: 'var(--bg-primary)',
              clipPath: 'polygon(0 0, 100% 0, 100% 75%, 75% 100%, 0 100%)',
            }}>CZ</div>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, letterSpacing: 3, color: 'var(--text-primary)' }}>
              CODE ZONE
            </span>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('login')}>SIGN IN</button>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('register')}>JOIN NOW</button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', padding: '80px 24px',
        background: theme === 'stalker'
          ? 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(232,124,42,0.08) 0%, transparent 70%)'
          : theme === 'cyberpunk'
          ? 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(0,245,255,0.06) 0%, rgba(155,0,255,0.04) 50%, transparent 70%)'
          : theme === 'hacker'
          ? 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(0,255,65,0.05) 0%, transparent 70%)'
          : 'none',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* decorative grid */}
        {theme !== 'minimal' && (
          <div style={{
            position: 'absolute', inset: 0, opacity: 0.03,
            backgroundImage: 'linear-gradient(var(--accent) 1px, transparent 1px), linear-gradient(90deg, var(--accent) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
            pointerEvents: 'none',
          }} />
        )}

        <div className="tag tag-accent" style={{ marginBottom: 24, animation: 'fadeIn 0.6s ease forwards' }}>
          MULTIPLAYER CODING SURVIVAL
        </div>

        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(48px, 12vw, 120px)',
          fontWeight: 900,
          letterSpacing: theme === 'minimal' ? 4 : 12,
          lineHeight: 0.9,
          color: 'var(--accent)',
          marginBottom: 24,
          textShadow: theme !== 'minimal' ? '0 0 60px var(--accent-glow)' : 'none',
          animation: 'fadeIn 0.4s ease forwards',
        }}>
          {titleText}
        </h1>

        <p style={{
          fontFamily: 'var(--font-body)',
          fontSize: 20,
          color: 'var(--text-secondary)',
          maxWidth: 560,
          lineHeight: 1.6,
          marginBottom: 48,
          animation: 'fadeIn 0.8s ease forwards',
        }}>
          Enter the arena. Solve faster than your enemies. Last coder standing claims victory.
        </p>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center', animation: 'fadeIn 1s ease forwards' }}>
          <button className="btn btn-primary btn-lg" onClick={() => navigate('register')}>
            ENTER THE ZONE
          </button>
          <button className="btn btn-outline btn-lg" onClick={() => navigate('login')}>
            CONTINUE MISSION
          </button>
        </div>

        {/* stats */}
        <div style={{
          display: 'flex', gap: 48, marginTop: 64,
          animation: 'fadeIn 1.2s ease forwards',
          flexWrap: 'wrap', justifyContent: 'center',
        }}>
          {[['10', 'MAX PLAYERS'], ['∞', 'ROUNDS'], ['4', 'THEMES'], ['1', 'WINNER']].map(([val, label]) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 900, color: 'var(--accent)' }}>{val}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: 3, color: 'var(--text-secondary)', marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section style={{ padding: '80px 24px', background: 'var(--bg-secondary)' }}>
        <div className="container">
          <div className="section-label" style={{ marginBottom: 48 }}>ARSENAL</div>
          <div className="grid-3" style={{ gap: 20 }}>
            {features.map((f, i) => (
              <div key={f.title} className="card" style={{ animationDelay: `${i * 0.1}s` }}>
                <div style={{ marginBottom: 12, color: 'var(--accent)' }}>
                  <FeatureIcon title={f.title} />
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, letterSpacing: 2, color: 'var(--text-accent)', marginBottom: 8 }}>
                  {f.title}
                </div>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section style={{ padding: '80px 24px' }}>
        <div className="container">
          <div className="section-label" style={{ marginBottom: 48 }}>BRIEFING</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
            {[
              { num: '01', title: 'Create or Join a Room', desc: 'Set up your battle arena or join an existing one with up to 10 players' },
              { num: '02', title: 'Ready Up', desc: 'All players confirm readiness. The host launches the match when everyone is in position' },
              { num: '03', title: 'Solve & Submit', desc: 'Race to solve coding challenges before the timer runs out. Faster = more points' },
              { num: '04', title: 'Survive the Elimination', desc: 'Slowest solver each round gets eliminated. Last one standing is the Champion' },
            ].map((step, i) => (
              <div key={step.num} style={{
                display: 'flex', gap: 32, alignItems: 'flex-start',
                padding: '32px 0',
                borderBottom: i < 3 ? '1px solid var(--border)' : 'none',
              }}>
                <div style={{
                  fontFamily: 'var(--font-display)', fontSize: 48, fontWeight: 900,
                  color: 'var(--accent)', opacity: 0.3, lineHeight: 1, flexShrink: 0, width: 80,
                }}>{step.num}</div>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, letterSpacing: 2, marginBottom: 8 }}>{step.title}</div>
                  <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: '80px 24px', background: 'var(--bg-secondary)', textAlign: 'center' }}>
        <div className="container">
          <div style={{
            border: '1px solid var(--border-accent)',
            borderRadius: 4, padding: '64px 32px',
            background: 'var(--accent-glow)',
          }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 900, letterSpacing: 4, marginBottom: 16 }}>
              READY TO ENTER THE ZONE?
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 32, fontSize: 16 }}>
              Register now and join the next battle
            </p>
            <button className="btn btn-primary btn-lg" onClick={() => navigate('register')}>
              START YOUR MISSION
            </button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ padding: '24px', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: 3, color: 'var(--text-secondary)' }}>
          CODE ZONE — MULTIPLAYER SURVIVAL PLATFORM
        </span>
      </footer>
    </div>
  );
};

export default LandingPage;
