import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import {
  CARDS,
  CATALOG,
  cardDisplayName,
  cardKindLabel,
  type CardCategory,
} from '@crashing/plugin-core';
import { cardCopy, useLanguage, useText } from './language';

const CORE_CARD_IDS = new Set(CATALOG.map((c) => c.id));

export type Category = CardCategory;
export { cardDisplayName as cardName, cardKindLabel as kindLabel };

/** The game origin that serves card art (crashingagents.com or the local preview server). */
export const AssetsContext = createContext('');
export const useAsset = (path: string) => {
  const origin = useContext(AssetsContext);
  return origin && path ? origin + path : '';
};

/** Optional inline base64 thumbnails for offline/instant-paint bundled plugins (e.g. BB). */
export const ThumbnailsContext = createContext<Record<string, string> | undefined>(undefined);

function Art({ type, full }: { type: string; full: boolean }) {
  const thumbnails = useContext(ThumbnailsContext);
  const folder = CORE_CARD_IDS.has(type) ? 'cards/' : 'cards/incidents/';
  const key = folder + type;
  const thumbnail = thumbnails?.[key] ?? thumbnails?.['cards/' + type] ?? thumbnails?.['cards/incidents/' + type];
  const deckBack = thumbnails?.['cards/deck-back'];
  const original = useAsset('/' + key + '.webp');

  if (!thumbnail) {
    const src = original || deckBack || '';
    return src ? <img src={src} alt="" draggable={false} /> : null;
  }

  return (
    <>
      <img src={thumbnail} alt="" draggable={false} />
      {full && original && (
        <img
          key={original}
          className="ca-art-detail"
          src={original}
          alt=""
          draggable={false}
          hidden
          onLoad={(event) => {
            event.currentTarget.hidden = false;
          }}
        />
      )}
    </>
  );
}

export type CardSize = 'mini' | 'hand' | 'md' | 'lg';

export function PaperCard({
  type,
  size = 'md',
  className = '',
  style,
  children,
}: {
  type: string;
  size?: CardSize;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const t = useText();
  const copy = cardCopy(type, useLanguage());
  const kind = cardKindLabel(type);
  const info = CARDS[type];
  const large = size === 'lg';
  return (
    <div
      className={`ca-card ca-card--${size} ${className}`}
      data-cat={info?.category ?? 'NONE'}
      style={style}
    >
      <div className="ca-card__band">
        <span className="ca-card__kind">{t(kind)}</span>
        <strong className="ca-card__name">{cardDisplayName(type)}</strong>
      </div>
      <div className="ca-card__art">
        <Art type={type} full={large} />
      </div>
      {size !== 'mini' && info?.effect && (
        <p className="ca-card__rule">{copy?.effect ?? info.effect}</p>
      )}
      {large && info?.lore && <p className="ca-card__lore">{copy?.lore ?? info.lore}</p>}
      {children}
    </div>
  );
}

export function CardBack({ className = '', style }: { className?: string; style?: CSSProperties }) {
  const thumbnails = useContext(ThumbnailsContext);
  const remoteBack = useAsset('/cards/deck-back.webp');
  const src = thumbnails?.['cards/deck-back'] ?? remoteBack;
  return (
    <div className={'ca-back ' + className} style={style}>
      {src && <img src={src} alt="" draggable={false} />}
    </div>
  );
}

/** Portrait for a seat: the site persona art for house bots, the mascot for agents, a monogram for people. */
export function Portrait({
  name,
  kind,
  personaId,
  size = 40,
  className = '',
}: {
  name: string;
  kind: 'human' | 'agent';
  personaId?: string;
  size?: number;
  className?: string;
}) {
  const thumbnails = useContext(ThumbnailsContext);
  const persona = personaId ? thumbnails?.['agents/' + personaId] : undefined;
  const remote = useAsset(personaId ? '/agents/' + personaId + '.webp' : '');
  const mascot = thumbnails?.['brand/mascot'] ?? useAsset('/brand/apple-touch-icon.png');
  const style = { '--size': size + 'px' } as CSSProperties;
  if (kind === 'agent') {
    const primary = persona || remote || mascot;
    return (
      <span className={'ca-portrait is-agent ' + className} style={style}>
        {primary && <img src={primary} alt="" draggable={false} />}
        {!persona && remote && primary !== remote && (
          <img
            key={remote}
            src={remote}
            alt=""
            hidden
            onLoad={(event) => {
              event.currentTarget.hidden = false;
            }}
            draggable={false}
          />
        )}
      </span>
    );
  }
  return (
    <span className={'ca-portrait is-human ' + className} style={style} aria-hidden="true">
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}
