import { LangToggle, useLang } from './i18n';

export default function HeaderLinks() {
  const { t } = useLang();
  return <div className="header-links">
    <LangToggle />
    <a className="github-link" href="https://github.com/Superone77/TraceVista" target="_blank" rel="noopener noreferrer" aria-label={t('View repository on GitHub')} title={t('View repository on GitHub')}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
        <path d="M12 .75a11.25 11.25 0 0 0-3.558 21.923c.563.103.768-.244.768-.542 0-.267-.01-.974-.015-1.912-3.13.68-3.79-1.508-3.79-1.508-.512-1.3-1.25-1.646-1.25-1.646-1.022-.7.077-.686.077-.686 1.13.08 1.725 1.16 1.725 1.16 1.004 1.72 2.635 1.224 3.276.936.102-.728.393-1.225.715-1.507-2.499-.284-5.126-1.25-5.126-5.563 0-1.229.44-2.234 1.16-3.021-.116-.284-.503-1.429.11-2.978 0 0 .945-.303 3.094 1.154A10.79 10.79 0 0 1 12 6.181a10.8 10.8 0 0 1 2.817.379c2.148-1.457 3.091-1.154 3.091-1.154.615 1.549.228 2.694.112 2.978.722.787 1.159 1.792 1.159 3.021 0 4.324-2.631 5.276-5.138 5.555.404.35.765 1.042.765 2.1 0 1.517-.014 2.741-.014 3.113 0 .3.203.65.774.54A11.252 11.252 0 0 0 12 .75Z" />
      </svg>
    </a>
  </div>;
}
