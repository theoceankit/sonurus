import React, { useEffect } from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import styles from './index.module.css';

/* ============================================================
   Inline SVGs
   ============================================================ */
const IconDownload = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
);

const IconGitHub = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.5v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.5-2.7 5.5-5.3 5.8.4.4.8 1.1.8 2.2v3.3c0 .3.2.6.8.5 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z" />
  </svg>
);

const IconCheck = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const IconLock = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);

const IconArrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14m-6-6 6 6-6 6" />
  </svg>
);

/* ============================================================
   Privacy lock SVG illustration
   ============================================================ */
function PrivacyLock() {
  return (
    <svg viewBox="0 0 240 280" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bodyGrad" x1="60" y1="120" x2="190" y2="262" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffd2a8" />
          <stop offset="0.36" stopColor="#ff8a5c" />
          <stop offset="0.7" stopColor="#ec4f73" />
          <stop offset="1" stopColor="#7d4fc4" />
        </linearGradient>
        <radialGradient id="lightTop" cx="0.34" cy="0.2" r="0.8">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.32" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="shadeBottom" cx="0.7" cy="1" r="0.7">
          <stop offset="0" stopColor="#3a0e30" stopOpacity="0.5" />
          <stop offset="1" stopColor="#3a0e30" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="shackleGrad" x1="80" y1="44" x2="160" y2="140" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#c4c3cf" />
          <stop offset="0.5" stopColor="#9594a2" />
          <stop offset="1" stopColor="#6c6b79" />
        </linearGradient>
        <linearGradient id="screenGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1d1118" />
          <stop offset="1" stopColor="#130b11" />
        </linearGradient>
        <linearGradient id="waveGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffdcc0" />
          <stop offset="1" stopColor="#ff916b" />
        </linearGradient>
      </defs>
      <path d="M82 138 V104 A38 38 0 0 1 158 104 V138" stroke="url(#shackleGrad)" strokeWidth="14" strokeLinecap="round" />
      <path d="M82 138 V104 A38 38 0 0 1 158 104" stroke="rgba(255,255,255,0.45)" strokeWidth="2.5" strokeLinecap="round" transform="translate(-2.5,-2)" />
      <rect x="54" y="128" width="132" height="138" rx="34" fill="url(#bodyGrad)" />
      <rect x="54" y="128" width="132" height="138" rx="34" fill="url(#shadeBottom)" />
      <rect x="54" y="128" width="132" height="138" rx="34" fill="url(#lightTop)" />
      <rect x="54.7" y="128.7" width="130.6" height="136.6" rx="33.3" stroke="rgba(255,255,255,0.22)" strokeWidth="1.4" />
      <rect x="78" y="164" width="84" height="70" rx="17" fill="url(#screenGrad)" />
      <rect x="78.7" y="164.7" width="82.6" height="68.6" rx="16.3" stroke="rgba(255,255,255,0.12)" strokeWidth="1.4" />
      <g fill="url(#waveGrad)">
        <rect x="90" y="190" width="6.5" height="18" rx="3.25" />
        <rect x="102" y="182" width="6.5" height="34" rx="3.25" />
        <rect x="114" y="175" width="6.5" height="48" rx="3.25" />
        <rect x="126" y="185" width="6.5" height="28" rx="3.25" />
        <rect x="138" y="180" width="6.5" height="38" rx="3.25" />
      </g>
    </svg>
  );
}

/* ============================================================
   Docs navigation cards data
   ============================================================ */
const DOC_CARDS = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
      </svg>
    ),
    title: 'API Reference',
    desc: 'REST endpoints, WebSocket protocol, request & response schemas.',
    to: '/api/endpoints',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 9h6M9 12h6M9 15h4" />
      </svg>
    ),
    title: 'State Machine',
    desc: 'Session, pipeline and transcript lifecycle — how the app moves between states.',
    to: '/system/state-machine',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    title: 'Invariants',
    desc: 'Six domain invariants that must hold across all services and state transitions.',
    to: '/system/invariants',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" />
      </svg>
    ),
    title: 'Roadmap',
    desc: 'Planned features and architectural improvements, organised by area.',
    to: '/roadmap/roadmap',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
    title: 'Known Issues',
    desc: 'Open bugs with severity ratings and planned fix descriptions.',
    to: '/known-issues',
    wide: true,
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
      </svg>
    ),
    title: 'Electron UI',
    desc: 'Views, sidebar, speaker colors, IPC bridge, security model.',
    to: '/ui/electron/overview',
  },
];

/* ============================================================
   Platform cards data
   ============================================================ */
const PLATFORMS = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.8-3-.8-1.5 0-2.9.9-3.7 2.3-1.6 2.7-.4 6.8 1.1 9 .7 1.1 1.6 2.3 2.7 2.2 1.1 0 1.5-.7 2.8-.7 1.3 0 1.6.7 2.8.7 1.2 0 1.9-1.1 2.6-2.1.8-1.2 1.2-2.4 1.2-2.4s-2.2-.9-2.3-3.5zM14.3 5.2c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.6.6-1 1.6-.9 2.6 1 .1 2-.5 2.6-1.2z" />
      </svg>
    ),
    name: 'macOS',
    meta: 'Universal · Apple silicon + Intel · 12.0+',
    label: 'Download .dmg',
    href: 'https://github.com/kit/sonorus/releases',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 5.6 10.3 4.6v6.9H3zM3 12.5h7.3v6.9L3 18.4zM11.2 4.5 21 3.2v8.3h-9.8zM11.2 12.5H21v8.3l-9.8-1.3z" />
      </svg>
    ),
    name: 'Windows',
    meta: 'x64 · Windows 10 & 11',
    label: 'Download .exe',
    href: 'https://github.com/kit/sonorus/releases',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2c-1.7 0-2.6 1.6-2.6 3.2 0 .9.1 1.6.1 2.4-.5.5-1.4 1.5-2.1 3.1-.6 1.3-1 2.3-1.6 3.1-.5.7-1.2 1.1-1.2 2 0 .6.4 1 .9 1.2-.1.4-.1.7 0 1 .2.6.9.9 1.7.9.5 0 1.1-.1 1.7-.1.7 0 1.2.3 2.1.9.6.4 1.3.6 2 .6.7 0 1.4-.2 2-.6.9-.6 1.4-.9 2.1-.9.6 0 1.2.1 1.7.1.8 0 1.5-.3 1.7-.9.1-.3.1-.6 0-1 .5-.2.9-.6.9-1.2 0-.9-.7-1.3-1.2-2-.6-.8-1-1.8-1.6-3.1-.7-1.6-1.6-2.6-2.1-3.1 0-.8.1-1.5.1-2.4C14.6 3.6 13.7 2 12 2z" />
      </svg>
    ),
    name: 'Linux',
    meta: 'AppImage · .deb · x86_64',
    label: 'Download build',
    href: 'https://github.com/kit/sonorus/releases',
  },
];

/* ============================================================
   Main page
   ============================================================ */
export default function Home() {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal');
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); } }),
      { threshold: 0.1 }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  return (
    <Layout title="Private meeting intelligence, on your device" description="Sonorus transcribes meetings, separates speakers, and writes AI summaries — entirely on your machine.">

      {/* ========== HERO ========== */}
      <header className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.wrap}>
          <div className={`reveal ${styles.heroMark}`}>
            <img src="/img/sonorus-icon.png" alt="Sonorus" />
          </div>
          <div className={`reveal ${styles.heroWordmark}`} data-d="1">Sonorus</div>
          <div className="reveal" data-d="1">
            <span className={styles.heroPill}>
              <span className={styles.dot} />
              100% on-device · audio never leaves your machine
            </span>
          </div>
          <h1 className={`reveal ${styles.heroH1}`} data-d="1">
            It understands the{' '}
            <em className={styles.gradInk}>conversation</em>,<br />
            not just the sound.
          </h1>
          <p className={`reveal ${styles.lede}`} data-d="2">
            Sonorus transcribes your meetings, tells your speakers apart, and writes the summary — all locally.
            No cloud, no uploads, no accounts. The recording stays exactly where you made it.
          </p>
          <div className={`reveal ${styles.heroActions}`} data-d="2">
            <a className={`${styles.btn} ${styles.btnPrimary}`} href="https://github.com/kit/sonorus/releases">
              <IconDownload />
              Download for macOS
            </a>
            <a className={`${styles.btn} ${styles.btnGhost}`} href="https://github.com/kit/sonorus">
              <IconGitHub />
              View on GitHub
            </a>
          </div>
          <div className={`reveal ${styles.heroMeta}`} data-d="3">
            <span><IconCheck /> Free &amp; open source</span>
            <span><IconCheck /> No account required</span>
            <span><IconCheck /> Works fully offline</span>
          </div>
        </div>
      </header>

      {/* ========== PRIVACY ========== */}
      <section className={`${styles.section} ${styles.sectionSm}`} id="privacy" style={{ paddingTop: '40px' }}>
        <div className={`${styles.wrap} ${styles.split}`}>
          <div className="reveal">
            <span className={styles.eyebrow}>Local processing &amp; security</span>
            <h2 className={styles.hSec}>Your meetings stay<br />on your machine.</h2>
            <p className={styles.subSec}>
              Sonorus was built privacy-first, not privacy-as-a-setting. There is no server to trust,
              because there is no server.
            </p>
            <ul className={styles.checklist}>
              {[
                { title: 'Nothing is uploaded', body: 'Audio, transcripts and summaries are processed entirely on-device. No cloud round-trips, ever.' },
                { title: 'No account, no telemetry', body: "Open the app and use it. We don't track usage and there's nothing to sign up for." },
                { title: 'Works fully offline', body: 'Pull the network cable and everything still runs. Air-gapped by design.' },
                { title: 'You hold the keys', body: 'Files are stored where you choose, in open formats. Delete a meeting and it’s actually gone.' },
              ].map(({ title, body }) => (
                <li key={title}>
                  <span className={styles.ck}><IconCheck /></span>
                  <div><b>{title}</b><span>{body}</span></div>
                </li>
              ))}
            </ul>
          </div>
          <div className={`reveal ${styles.privacyScene}`} data-d="2">
            <div className={styles.psGlow} />
            <div className={styles.psLock}><PrivacyLock /></div>
          </div>
        </div>
      </section>

      {/* ========== PIPELINE ========== */}
      <section className={`${styles.section} ${styles.sectionSm}`} id="how">
        <div className={styles.wrap}>
          <div className={`reveal ${styles.secHead}`}>
            <span className={styles.eyebrow}>The pipeline</span>
            <h2 className={styles.hSec}>From raw audio to an understood meeting</h2>
            <p className={styles.subSec}>
              Every stage runs on your own hardware, in sequence. Nothing is queued to a server.
              Nothing waits in someone else&apos;s cloud.
            </p>
          </div>

          <div className="reveal" data-d="1">
            <div className={styles.sfRow}>
              {/* 01 */}
              <div className={styles.sfStage}>
                <div className={`${styles.sfViz} ${styles.vizWave}`} aria-hidden>
                  {[34,58,42,76,50,92,62,38,70,84,46,60,96,52,40,68,80,44,62,88,54,36,72,48].map((h, i) => (
                    <i key={i} style={{ '--h': `${h}%` }} />
                  ))}
                </div>
                <span className={styles.sfNo}>01</span>
                <h4>Capture</h4>
                <p>Record a meeting or drop in an existing file. Stays on disk, untouched.</p>
                <span className={styles.sfTag}>.wav · .m4a · .mp3</span>
              </div>
              {/* 02 */}
              <div className={styles.sfStage}>
                <div className={`${styles.sfViz} ${styles.vizText}`} aria-hidden>
                  {[['00:14', '74%'], ['00:21', '92%'], ['00:29', '60%']].map(([ts, w]) => (
                    <div key={ts} className={styles.ln}>
                      <span className={styles.ts}>{ts}</span>
                      <span className={styles.bar} style={{ width: w }} />
                    </div>
                  ))}
                </div>
                <span className={styles.sfNo}>02</span>
                <h4>Transcribe</h4>
                <p>A local speech model turns audio into accurate, timestamped text.</p>
                <span className={styles.sfTag}>word-level timing</span>
              </div>
              {/* 03 */}
              <div className={styles.sfStage}>
                <div className={`${styles.sfViz} ${styles.vizDiar}`} aria-hidden>
                  <div className={styles.lane}>
                    <span className={styles.seg} style={{ left:'2%', width:'30%', background:'linear-gradient(135deg,var(--peach),var(--coral))' }} />
                    <span className={styles.seg} style={{ left:'70%', width:'18%', background:'linear-gradient(135deg,var(--peach),var(--coral))' }} />
                  </div>
                  <div className={styles.lane}>
                    <span className={styles.seg} style={{ left:'38%', width:'26%', background:'linear-gradient(135deg,var(--rose),var(--magenta))' }} />
                  </div>
                  <div className={styles.lane}>
                    <span className={styles.seg} style={{ left:'66%', width:'14%', background:'linear-gradient(135deg,#6fd0ff,#4f7bff)' }} />
                    <span className={styles.seg} style={{ left:'14%', width:'18%', background:'linear-gradient(135deg,#6fd0ff,#4f7bff)' }} />
                  </div>
                </div>
                <span className={styles.sfNo}>03</span>
                <h4>Separate</h4>
                <p>Diarization assigns every line to the right speaker — automatically.</p>
                <span className={styles.sfTag}>who-said-what</span>
              </div>
              {/* 04 */}
              <div className={styles.sfStage}>
                <div className={`${styles.sfViz} ${styles.vizSum}`} aria-hidden>
                  {['68%','88%','54%'].map((w) => (
                    <div key={w} className={styles.item}>
                      <span className={styles.chk}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6" /></svg>
                      </span>
                      <span className={styles.bar} style={{ width: w }} />
                    </div>
                  ))}
                </div>
                <span className={styles.sfNo}>04</span>
                <h4>Summarize</h4>
                <p>A local model writes the recap, decisions, and action items you can act on.</p>
                <span className={styles.sfTag}>recap · tasks</span>
              </div>
            </div>

            <div className={styles.sfNote}>
              <IconLock />
              <span><b>Zero network egress.</b> Run the entire pipeline with Wi-Fi switched off — the result is identical.</span>
            </div>
          </div>
        </div>
      </section>

      {/* ========== DOCS NAVIGATION ========== */}
      <section className={styles.section} id="capabilities">
        <div className={styles.wrap}>
          <div className={`reveal ${styles.secHead}`}>
            <span className={styles.eyebrow}>Documentation</span>
            <h2 className={styles.hSec}>Everything you need to build with Sonorus</h2>
            <p className={styles.subSec}>
              Architecture deep-dives, API reference, invariants, and the full roadmap —
              all in one place.
            </p>
          </div>
          <div className={styles.bento}>
            {DOC_CARDS.map(({ icon, title, desc, to, wide }, i) => (
              <Link
                key={title}
                to={to}
                className={`reveal ${styles.card} ${wide ? styles.wide : ''}`}
                data-d={String((i % 3) + 1)}
              >
                <div className={styles.cardIco}>{icon}</div>
                <h3>{title}</h3>
                <p>{desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ========== PLATFORMS ========== */}
      <section className={`${styles.section} ${styles.sectionSm}`} id="download">
        <div className={styles.wrap}>
          <div className={`reveal ${styles.secHead}`}>
            <span className={styles.eyebrow}>Built for the desktop</span>
            <h2 className={styles.hSec}>Native on every machine you use</h2>
            <p className={styles.subSec}>
              A real desktop application — not a browser tab. Download a build for your platform
              and run it locally.
            </p>
          </div>
          <div className={styles.platforms}>
            {PLATFORMS.map(({ icon, name, meta, label, href }, i) => (
              <div key={name} className={`reveal ${styles.pf}`} data-d={String(i + 1)}>
                <div className={styles.pfIco}>{icon}</div>
                <h4>{name}</h4>
                <div className={styles.pfMeta}>{meta}</div>
                <a className={styles.dl} href={href}>
                  {label} <IconArrow />
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

    </Layout>
  );
}
