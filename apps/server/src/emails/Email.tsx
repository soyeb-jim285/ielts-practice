import { Body, Button, Column, Container, Head, Hr, Html, Img, Link, Markdown, Preview, Row, Section, Text } from '@react-email/components';
import type { CSSProperties } from 'react';
import type { Block, EmailSettings } from './blocks';

/** Brand: teal #0f766e (AA on white), ink #0f172a, muted #5b6b80, line #e3e8ef. */
const C = { brand: '#0f766e', brandDeep: '#0b5d57', soft: '#ddf3ef', ink: '#0f172a', muted: '#5b6b80', line: '#e3e8ef', page: '#eef2f6', panel: '#f5f8fa', white: '#ffffff' };
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";
const PAD = 32;

export type EmailKind = 'account' | 'promo';
export type EmailProps = { preheader: string; blocks: Block[]; settings: EmailSettings; origin: string; kind: EmailKind; unsubscribeUrl: string };

const abs = (origin: string, u: string) => (u.startsWith('/') ? `${origin}${u}` : u);

const md = {
  p: { margin: '0 0 16px', fontSize: 16, lineHeight: '26px', color: C.ink },
  bold: { fontWeight: 600, color: C.ink },
  link: { color: C.brand, textDecoration: 'underline' },
  ul: { margin: '0 0 16px', paddingLeft: 22 },
  ol: { margin: '0 0 16px', paddingLeft: 22 },
  li: { margin: '0 0 6px', fontSize: 16, lineHeight: '24px', color: C.ink },
  h2: { margin: '8px 0 12px', fontSize: 18, lineHeight: '26px', fontWeight: 600, color: C.ink },
  h3: { margin: '8px 0 10px', fontSize: 16, lineHeight: '24px', fontWeight: 600, color: C.ink },
  table: { width: '100%', borderCollapse: 'collapse', margin: '4px 0 20px', fontSize: 14 },
  th: { textAlign: 'left', padding: '10px 12px', background: C.panel, border: `1px solid ${C.line}`, color: C.ink, fontWeight: 600 },
  td: { padding: '10px 12px', border: `1px solid ${C.line}`, color: C.ink },
  codeInline: { fontFamily: 'Menlo, Consolas, monospace', fontSize: 14, background: C.panel, padding: '1px 5px', borderRadius: 4 },
  blockQuote: { margin: '0 0 16px', padding: '4px 16px', background: C.panel, color: C.muted },
} satisfies Record<string, CSSProperties>;

const TONE = {
  brand: { bg: C.brand, strip: C.brandDeep, text: C.white, eyebrow: '#c9efe9' },
  ink: { bg: C.ink, strip: '#1e293b', text: C.white, eyebrow: '#b6c2d2' },
  soft: { bg: C.soft, strip: '#c6ebe4', text: C.ink, eyebrow: C.brand },
};
const CALLOUT = { info: { bg: '#e8f1fb', title: '#1e3a8a', mark: 'i' }, good: { bg: '#e6f6ee', title: '#14532d', mark: '✓' }, warn: { bg: '#fdf3e2', title: '#7c3d06', mark: '!' } };

function Hero({ b, top }: { b: Extract<Block, { type: 'hero' }>; top?: boolean }) {
  const t = TONE[b.tone];
  return (
    <Section style={{ background: t.bg, borderRadius: top ? '12px 12px 0 0' : 10 }}>
      <Section style={{ padding: `28px ${PAD}px ${b.subtitle ? 24 : 28}px` }}>
        {b.eyebrow && <Text style={{ margin: '0 0 8px', fontSize: 13, lineHeight: '18px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: t.eyebrow }}>{b.eyebrow}</Text>}
        <Text style={{ margin: 0, fontFamily: SERIF, fontSize: 28, lineHeight: '34px', fontWeight: 600, color: t.text }}>{b.title}</Text>
      </Section>
      {b.subtitle && (
        <Section style={{ background: t.strip, padding: `12px ${PAD}px` }}>
          <Text style={{ margin: 0, fontSize: 14, lineHeight: '20px', fontWeight: 500, color: t.text }}>{b.subtitle}</Text>
        </Section>
      )}
    </Section>
  );
}

function Details({ b }: { b: Extract<Block, { type: 'details' }> }) {
  return (
    <Section style={{ margin: '0 0 20px' }}>
      {b.title && <Text style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: C.muted }}>{b.title}</Text>}
      {b.rows.map((r, i) => (
        <Row key={i} style={{ borderBottom: `1px solid ${C.line}` }}>
          <Column style={{ padding: '12px 0', fontSize: 15, lineHeight: '22px', color: C.muted, verticalAlign: 'top' }}>{r.label}</Column>
          <Column style={{ padding: '12px 0 12px 16px', fontSize: 15, lineHeight: '22px', color: C.ink, fontWeight: 600, textAlign: 'right', verticalAlign: 'top' }}>{r.value}</Column>
        </Row>
      ))}
    </Section>
  );
}

function Stat({ s }: { s: Extract<Block, { type: 'stats' }>['items'][number] }) {
  const pill = s.trend === 'up' ? { bg: '#dcfce7', fg: '#166534', arrow: '↑ ' } : s.trend === 'down' ? { bg: '#fee2e2', fg: '#991b1b', arrow: '↓ ' } : { bg: C.line, fg: C.ink, arrow: '' };
  return (
    <Section style={{ background: C.panel, borderRadius: 10, padding: '16px 18px' }}>
      <Row>
        <Column style={{ fontSize: 26, lineHeight: '32px', fontWeight: 700, color: C.ink }}>{s.value}</Column>
        {s.change && (
          <Column align="right" style={{ verticalAlign: 'top' }}>
            <span style={{ display: 'inline-block', background: pill.bg, color: pill.fg, borderRadius: 999, padding: '3px 9px', fontSize: 12, fontWeight: 600, lineHeight: '16px', whiteSpace: 'nowrap' }}>
              {pill.arrow}
              {s.change}
            </span>
          </Column>
        )}
      </Row>
      <Text style={{ margin: '4px 0 0', fontSize: 14, lineHeight: '20px', color: C.muted }}>{s.label}</Text>
    </Section>
  );
}

function Stats({ b }: { b: Extract<Block, { type: 'stats' }> }) {
  const rows: (typeof b.items)[] = [];
  for (let i = 0; i < b.items.length; i += 2) rows.push(b.items.slice(i, i + 2));
  return (
    <Section style={{ margin: '0 0 12px' }}>
      {rows.map((r, i) => (
        <Row key={i} style={{ marginBottom: 8 }}>
          {r.map((s, j) => (
            <Column key={j} style={{ width: '50%', padding: j === 0 ? '0 4px 8px 0' : '0 0 8px 4px', verticalAlign: 'top' }}>
              <Stat s={s} />
            </Column>
          ))}
          {r.length === 1 && <Column style={{ width: '50%' }} />}
        </Row>
      ))}
    </Section>
  );
}

function BlockView({ b, origin }: { b: Block; origin: string }) {
  switch (b.type) {
    case 'text':
      return <Markdown markdownCustomStyles={md} markdownContainerStyles={{ fontFamily: FONT }}>{b.text}</Markdown>;
    case 'button':
      return (
        <Section style={{ margin: '8px 0 20px' }}>
          <Button
            href={abs(origin, b.url)}
            style={
              b.variant === 'solid'
                ? { background: C.brand, color: C.white, borderRadius: 8, padding: '13px 26px', fontSize: 16, fontWeight: 600, lineHeight: '20px', textDecoration: 'none' }
                : { background: C.white, color: C.brand, border: `2px solid ${C.brand}`, borderRadius: 8, padding: '11px 24px', fontSize: 16, fontWeight: 600, lineHeight: '20px', textDecoration: 'none' }
            }
          >
            {b.label}
          </Button>
        </Section>
      );
    case 'code':
      return (
        <Section style={{ margin: '4px 0 20px' }}>
          <Text style={{ display: 'inline-block', margin: 0, background: C.soft, borderRadius: 10, padding: '14px 22px', fontFamily: "'SF Mono', Menlo, Consolas, monospace", fontSize: 32, lineHeight: '40px', fontWeight: 700, letterSpacing: '8px', color: C.ink }}>{b.value}</Text>
        </Section>
      );
    case 'details':
      return <Details b={b} />;
    case 'stats':
      return <Stats b={b} />;
    case 'callout': {
      const t = CALLOUT[b.tone];
      return (
        <Section style={{ background: t.bg, borderRadius: 10, padding: '16px 18px', margin: '0 0 20px' }}>
          <Row>
            <Column style={{ width: 28, verticalAlign: 'top' }}>
              <span style={{ display: 'inline-block', width: 20, height: 20, borderRadius: 999, background: t.title, color: C.white, fontSize: 12, fontWeight: 700, lineHeight: '20px', textAlign: 'center' }}>{t.mark}</span>
            </Column>
            <Column style={{ verticalAlign: 'top' }}>
              {b.title && <Text style={{ margin: '0 0 4px', fontSize: 15, lineHeight: '22px', fontWeight: 600, color: t.title }}>{b.title}</Text>}
              <Text style={{ margin: 0, fontSize: 15, lineHeight: '22px', color: C.ink }}>{b.text}</Text>
            </Column>
          </Row>
        </Section>
      );
    }
    case 'image': {
      const img = <Img src={abs(origin, b.src)} alt={b.alt} width="496" style={{ display: 'block', width: '100%', maxWidth: 496, height: 'auto', borderRadius: 10 }} />;
      return <Section style={{ margin: '0 0 20px' }}>{b.href ? <Link href={abs(origin, b.href)}>{img}</Link> : img}</Section>;
    }
    case 'divider':
      return <Hr style={{ borderColor: C.line, margin: '8px 0 24px' }} />;
    case 'hero': // a later hero: an inset banner (a leading one runs edge to edge, see Email)
      return (
        <Section style={{ borderRadius: 10, overflow: 'hidden', margin: '4px 0 20px' }}>
          <Hero b={b} />
        </Section>
      );
  }
}

const SOCIAL = ['facebook', 'instagram', 'youtube', 'x', 'tiktok'] as const;
const SOCIAL_NAME = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', x: 'X', tiktok: 'TikTok' };

function Footer({ settings: s, origin, kind, unsubscribeUrl }: Pick<EmailProps, 'settings' | 'origin' | 'kind' | 'unsubscribeUrl'>) {
  const small: CSSProperties = { margin: '0 0 8px', fontSize: 12, lineHeight: '18px', color: '#9fb0c4' };
  const link: CSSProperties = { color: '#d6e0eb', textDecoration: 'underline' };
  const socials = SOCIAL.filter((k) => s.social[k]);
  const links = [
    { label: 'Privacy', href: `${origin}/privacy` },
    ...(s.supportEmail ? [{ label: 'Help', href: `mailto:${s.supportEmail}` }] : []),
    ...(kind === 'promo' ? [{ label: 'Manage preferences', href: `${origin}/settings` }, { label: 'Unsubscribe', href: unsubscribeUrl }] : []),
  ];
  return (
    <Section style={{ background: C.ink, borderRadius: 12, padding: `28px ${PAD}px`, marginTop: 16 }}>
      <Img src={`${origin}/nextband/logo-dark.png`} width="120" height="24" alt={s.company} style={{ display: 'block', width: 120, height: 'auto', margin: '0 0 10px' }} />
      <Text style={{ margin: '0 0 18px', fontSize: 14, lineHeight: '20px', color: '#d6e0eb' }}>IELTS practice with instant band scores.</Text>
      {socials.length > 0 && (
        <Section style={{ margin: '0 0 16px' }}>
          {socials.map((k) => (
            <Link key={k} href={s.social[k]} style={{ display: 'inline-block', marginRight: 14 }}>
              <Img src={`${origin}/email/${k}.png`} width="20" height="20" alt={SOCIAL_NAME[k]} style={{ display: 'block', width: 20, height: 20, opacity: 0.85 }} />
            </Link>
          ))}
        </Section>
      )}
      <Text style={{ ...small, margin: '0 0 14px', fontSize: 13 }}>
        {links.map((l, i) => (
          <span key={l.label}>
            {i > 0 && <span style={{ color: '#5b6b80' }}>{'  ·  '}</span>}
            <Link href={l.href} style={link}>
              {l.label}
            </Link>
          </span>
        ))}
      </Text>
      <Text style={small}>
        {kind === 'promo'
          ? `You are getting this because you have a ${s.company} account with product news turned on.`
          : `You are getting this because of activity on your ${s.company} account. Account and security emails are always sent.`}
      </Text>
      {s.address && <Text style={small}>{s.address}</Text>}
      <Text style={small}>
        © {new Date().getFullYear()} {s.company}. IELTS is a registered trademark of the British Council, IDP: IELTS Australia and Cambridge University Press &amp; Assessment. {s.company} is not affiliated with, approved or endorsed by them.
      </Text>
    </Section>
  );
}

/** The house layout: logo + "Open NextBand" link, a white card (a leading hero runs edge to edge), then the dark footer. */
export function Email({ preheader, blocks, settings, origin, kind, unsubscribeUrl }: EmailProps) {
  const [first, ...rest] = blocks;
  const hero = first?.type === 'hero' ? first : null;
  const body = hero ? rest : blocks;
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      {preheader && <Preview>{preheader}</Preview>}
      <Body style={{ margin: 0, background: C.page, fontFamily: FONT, WebkitTextSizeAdjust: '100%' }}>
        <Container style={{ maxWidth: 584, width: '100%' }}>
          {/* padding on a cell, not the table: a padded width:100% table overflows narrow screens */}
          <Row>
            <Column style={{ padding: '32px 12px' }}>
          <Section style={{ padding: '0 4px 18px' }}>
            <Row>
              <Column>
                <Link href={origin}>
                  <Img src={`${origin}/nextband/logo.png`} width="132" height="26" alt={settings.company} style={{ display: 'block', width: 132, height: 'auto' }} />
                </Link>
              </Column>
              <Column align="right">
                <Link href={origin} style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: C.brand, textDecoration: 'none' }}>
                  Open {settings.company}
                </Link>
              </Column>
            </Row>
          </Section>
          <Section style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden' }}>
            {hero && <Hero b={hero} top />}
            {body.length > 0 && (
              <Section style={{ padding: `${hero ? 28 : PAD}px ${PAD}px 12px` }}>
                {body.map((b, i) => (
                  <BlockView key={i} b={b} origin={origin} />
                ))}
              </Section>
            )}
          </Section>
          <Footer settings={settings} origin={origin} kind={kind} unsubscribeUrl={unsubscribeUrl} />
            </Column>
          </Row>
        </Container>
      </Body>
    </Html>
  );
}
