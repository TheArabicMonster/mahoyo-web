/**
 * Browser half of the "Crédits restants DSH" panel.
 *
 * Two registrations, both through the shell's own seats: a row in the left
 * sidebar's global panel list (`sidebar.panellist`) and its page in the keyed
 * `main` slot. The shell keeps the row box, the label, the active highlight,
 * the collapsed rail and the panel switch, so nothing here re-parents or hides
 * any other surface.
 *
 * Data comes from this package's Host half through two exact Fetch routes on
 * the Host's authenticated `/api` channel. Addresses are DOCUMENT-RELATIVE
 * because the page is served with `<base href="./">`: a root-absolute path
 * would escape a sub-path mount.
 *
 * @module @dsh-local/view-9d8b1b1d-9385-48b3-84eb-73e6b545a530
 */
window.__ModuleLoader__.load({
  id: '@dsh-local/view-9d8b1b1d-9385-48b3-84eb-73e6b545a530',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Panel id shared by the sidebar row and the main-slot occupant. */
    const PANEL_ID = 'dsh-credits-9d8b1b1d'
    /** Locale namespace this plugin owns. */
    const NS = 'dsh-credits'
    /** Row order among the shell's global panel rows (Plugins is 0, Schedule 10). */
    const PANEL_ORDER = 25
    /** Document-relative addresses of the Host half's two routes. */
    const STATE_URL = 'api/dsh-credits-9d8b1b1d/state'
    const REFRESH_URL = 'api/dsh-credits-9d8b1b1d/refresh'

    /** @type {Record<string, string>} */
    const EN = {
      'entry.label': 'Remaining credits',
      'page.title': 'Remaining credits',
      'page.subtitle': 'Billing balance of the account DSH uses',
      'action.refresh': 'Refresh',
      'action.refreshing': 'Refreshing…',
      'status.loading': 'Loading…',
      'status.updated_at': 'Last refreshed: {at}',
      'status.never_refreshed': 'Never refreshed',
      'empty.title': 'No known balance yet',
      'empty.body': 'Refresh to read the balance from the provider billing.',
      'wallet.topped_up': 'Topped up',
      'wallet.granted': 'Granted',
      'notice.insufficient': 'The balance is below what API calls need.',
      'warning.title': 'The last refresh failed.',
      'warning.stale': 'The amount shown was read on {at}.',
      'warning.no_value': 'No earlier value is known.',
      'error.title': 'Balance unavailable',
      'error.no_key': 'No DeepSeek API key is configured for DSH. Add one in the model settings.',
      'error.unauthorized': 'The provider refused the API key (401).',
      'error.timeout': 'The provider did not answer in time.',
      'error.network': 'The provider could not be reached.',
      'error.provider': 'The provider answered with something this panel does not understand.',
      'error.internal': 'The balance could not be read on this machine.',
      'error.not_mounted': 'The plugin Host half is not loaded, so no route answers.',
      'error.host': 'The panel route returned an error.',
    }

    /** @type {Record<string, string>} */
    const FR = {
      'entry.label': 'Crédits restants',
      'page.title': 'Crédits restants',
      'page.subtitle': 'Solde de facturation du compte utilisé par DSH',
      'action.refresh': 'Actualiser',
      'action.refreshing': 'Actualisation…',
      'status.loading': 'Chargement…',
      'status.updated_at': 'Dernière actualisation : {at}',
      'status.never_refreshed': 'Jamais actualisée',
      'empty.title': 'Aucune valeur connue',
      'empty.body': 'Actualisez pour lire le solde depuis la facturation du fournisseur.',
      'wallet.topped_up': 'Rechargé',
      'wallet.granted': 'Offert',
      'notice.insufficient': 'Le solde est insuffisant pour les appels à l’API.',
      'warning.title': 'La dernière actualisation a échoué.',
      'warning.stale': 'Le montant affiché a été lu le {at}.',
      'warning.no_value': 'Aucune valeur antérieure n’est connue.',
      'error.title': 'Solde indisponible',
      'error.no_key': 'Aucune clé API DeepSeek n’est configurée pour DSH. Ajoutez-la dans les réglages des modèles.',
      'error.unauthorized': 'La clé API a été refusée par le fournisseur (401).',
      'error.timeout': 'Le fournisseur n’a pas répondu à temps.',
      'error.network': 'Le fournisseur est injoignable.',
      'error.provider': 'Le fournisseur a renvoyé une réponse inattendue.',
      'error.internal': 'Le solde n’a pas pu être lu sur cette machine.',
      'error.not_mounted': 'La moitié Host du plugin n’est pas chargée : aucune route ne répond.',
      'error.host': 'La route du panneau a renvoyé une erreur.',
    }

    /** @type {Record<string, string>} */
    const ZH = {
      'entry.label': '剩余额度',
      'page.title': '剩余额度',
      'page.subtitle': 'DSH 所用账户的计费余额',
      'action.refresh': '刷新',
      'action.refreshing': '刷新中…',
      'status.loading': '加载中…',
      'status.updated_at': '上次刷新：{at}',
      'status.never_refreshed': '尚未刷新',
      'empty.title': '暂无已知余额',
      'empty.body': '刷新以从服务商计费读取余额。',
      'wallet.topped_up': '充值',
      'wallet.granted': '赠送',
      'notice.insufficient': '余额不足以继续调用 API。',
      'warning.title': '上次刷新失败。',
      'warning.stale': '显示的金额读取于 {at}。',
      'warning.no_value': '没有更早的已知值。',
      'error.title': '余额不可用',
      'error.no_key': 'DSH 未配置 DeepSeek API 密钥。请在模型设置中添加。',
      'error.unauthorized': '服务商拒绝了该 API 密钥（401）。',
      'error.timeout': '服务商未及时响应。',
      'error.network': '无法连接到服务商。',
      'error.provider': '服务商返回了本面板无法识别的响应。',
      'error.internal': '无法在本机读取余额。',
      'error.not_mounted': '插件的 Host 半未加载，没有路由响应。',
      'error.host': '面板自身的路由返回了错误。',
    }

    /** Failure code to dictionary key; unknown codes read as a plain route error. */
    const FAILURE_KEYS = {
      'no-key': 'error.no_key',
      unauthorized: 'error.unauthorized',
      timeout: 'error.timeout',
      network: 'error.network',
      offline: 'error.network',
      provider: 'error.provider',
      internal: 'error.internal',
      'not-mounted': 'error.not_mounted',
      'host-error': 'error.host',
    }

    /** Styles ride the host's `--dsw-alias-*` tokens so light/dark stays automatic. */
    const STYLES = `
[data-dsh-credits-view]{display:block;box-sizing:border-box;width:100%;height:100%;min-width:0;overflow:auto;background:var(--dsw-alias-bg-base);}
[data-dsh-credits-view] .page{box-sizing:border-box;width:100%;max-width:760px;margin:0 auto;padding:28px 28px 56px;display:flex;flex-direction:column;gap:18px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;}
[data-dsh-credits-view] .head{display:flex;align-items:flex-start;gap:12px;min-width:0;}
[data-dsh-credits-view] .glyph{display:flex;align-items:center;justify-content:center;flex:0 0 32px;width:32px;height:32px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);}
[data-dsh-credits-view] .head-text{flex:1 1 auto;min-width:0;}
[data-dsh-credits-view] h1{margin:0;font-size:16px;font-weight:600;letter-spacing:.01em;color:var(--dsw-alias-label-primary);}
[data-dsh-credits-view] .sub{margin:2px 0 0;font-size:12px;color:var(--dsw-alias-label-tertiary);}
[data-dsh-credits-view] .card{display:flex;flex-direction:column;gap:14px;box-sizing:border-box;padding:18px 20px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-2);}
[data-dsh-credits-view] .wallets{display:flex;flex-direction:column;gap:16px;}
[data-dsh-credits-view] .amount{font-size:30px;font-weight:600;line-height:1.15;letter-spacing:-.01em;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);}
[data-dsh-credits-view] .breakdown{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:4px;font-size:12px;color:var(--dsw-alias-label-secondary);}
[data-dsh-credits-view] .dot{color:var(--dsw-alias-label-tertiary);}
[data-dsh-credits-view] .foot{padding-top:12px;border-top:1px solid var(--dsw-alias-border-subtle);font-size:12px;color:var(--dsw-alias-label-tertiary);}
[data-dsh-credits-view] .muted{margin:0;color:var(--dsw-alias-label-tertiary);}
[data-dsh-credits-view] .block{margin:0;font-size:12px;}
[data-dsh-credits-view] .block strong{display:block;margin-bottom:2px;font-size:13px;font-weight:600;}
[data-dsh-credits-view] .block p{margin:0;color:var(--dsw-alias-label-secondary);}
[data-dsh-credits-view] .block.warn{color:var(--dsw-alias-state-warn-primary);}
[data-dsh-credits-view] .block.error{color:var(--dsw-alias-state-error-primary);}
[data-dsh-credits-view] .notice{margin:0;padding:8px 10px;border:1px solid var(--dsw-alias-border-subtle);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-state-warn-primary);font-size:12px;}
[data-dsh-credits-view] .btn{appearance:none;flex:0 0 auto;height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;}
[data-dsh-credits-view] .btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);}
[data-dsh-credits-view] .btn:disabled{opacity:.6;cursor:default;}
[data-dsh-credits-view] .btn.primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);}
[data-dsh-credits-view] .btn.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);}
[data-dsh-credits-view] .btn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-focus);}
@media (max-width:560px){[data-dsh-credits-view] .page{padding:20px 16px 40px;}}
`

    /** A failed panel request, carrying the code the wording switches on. */
    class PanelFailure extends Error {
      /** @param {string} code - stable failure code. */
      constructor(code) {
        super(code)
        this.name = 'PanelFailure'
        this.code = code
      }
    }

    /**
     * Read one JSON answer from the plugin's Host half.
     * @param {string} url - document-relative route.
     * @param {RequestInit} init - request init without the shared options.
     * @returns {Promise<any>} the decoded body.
     */
    async function readJson(url, init) {
      let response
      try {
        response = await fetch(url, { ...init, cache: 'no-store', credentials: 'same-origin' })
      } catch {
        throw new PanelFailure('offline')
      }
      if (response.status === 404) throw new PanelFailure('not-mounted')
      if (!response.ok) throw new PanelFailure('host-error')
      try {
        return await response.json()
      } catch {
        throw new PanelFailure('host-error')
      }
    }

    /** Read the last known value; never calls the provider. */
    const loadState = () => readJson(STATE_URL, { method: 'GET', headers: { accept: 'application/json' } })
    /** Ask the Host to read the provider and persist the outcome. */
    const refreshState = () => readJson(REFRESH_URL, { method: 'POST', headers: { accept: 'application/json' } })

    /**
     * Re-render when the active locale changes: the shell resolves the sidebar
     * label itself, this covers the page text.
     * @param {any} locale - client locale service.
     */
    function useLocaleRevision(locale) {
      const subscribe = React.useCallback((notify) => locale.subscribe(notify), [locale])
      const revision = React.useCallback(() => locale.getSnapshot().revision, [locale])
      React.useSyncExternalStore(subscribe, revision, revision)
    }

    /**
     * One wallet as the page needs it: numbers, already narrowed.
     * @param {any} state - state document from the Host half.
     * @returns {Array<{ currency: string, total: number, toppedUp: number, granted: number }>} wallets.
     */
    function walletsOf(state) {
      const entries = state !== null && typeof state === 'object' && Array.isArray(state.wallets) ? state.wallets : []
      const wallets = []
      for (const entry of entries) {
        if (entry === null || typeof entry !== 'object') continue
        const currency = typeof entry.currency === 'string' ? entry.currency : ''
        if (currency === '') continue
        wallets.push({
          currency,
          total: Number(entry.total),
          toppedUp: Number(entry.toppedUp),
          granted: Number(entry.granted),
        })
      }
      return wallets
    }

    /**
     * Sum the reported wallets per currency. The provider normally reports one
     * wallet per currency; summing keeps a repeated currency correct.
     * @param {Array<{ currency: string, total: number, toppedUp: number, granted: number }>} wallets - narrowed wallets.
     * @returns {Array<{ currency: string, total: number, toppedUp: number, granted: number }>} per-currency totals.
     */
    function totalsByCurrency(wallets) {
      const byCurrency = new Map()
      for (const wallet of wallets) {
        const bucket = byCurrency.get(wallet.currency) ?? { currency: wallet.currency, total: 0, toppedUp: 0, granted: 0 }
        bucket.total += Number.isFinite(wallet.total) ? wallet.total : 0
        bucket.toppedUp += Number.isFinite(wallet.toppedUp) ? wallet.toppedUp : 0
        bucket.granted += Number.isFinite(wallet.granted) ? wallet.granted : 0
        byCurrency.set(wallet.currency, bucket)
      }
      return Array.from(byCurrency.values())
    }

    /**
     * Format one amount in its own currency.
     * @param {number} amount - numeric amount.
     * @param {string} currency - ISO currency code from the provider.
     * @returns {string} the formatted amount.
     */
    function formatAmount(amount, currency) {
      const value = Number.isFinite(amount) ? amount : 0
      try {
        return new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency,
          currencyDisplay: 'narrowSymbol',
        }).format(value)
      } catch {
        return `${value.toFixed(2)} ${currency}`
      }
    }

    /**
     * Format one ISO timestamp in the reader's own locale and zone.
     * @param {string} iso - ISO timestamp.
     * @returns {string} the formatted timestamp.
     */
    function formatTime(iso) {
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return String(iso)
      try {
        return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
      } catch {
        return date.toLocaleString()
      }
    }

    /**
     * Wording for one failure code.
     * @param {(key: string, params?: Record<string, string>) => string} t - bound translate.
     * @param {unknown} code - failure code.
     * @returns {string} the sentence to show.
     */
    function failureText(t, code) {
      const key = typeof code === 'string' ? FAILURE_KEYS[code] : undefined
      return t(key ?? 'error.host')
    }

    /** Coiled coin glyph; the sidebar row and the page header share it. */
    function CoinGlyph({ size }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('circle', { key: 'coin', cx: 8, cy: 8, r: 6 }),
        h('path', { key: 'mark', d: 'M5.9 5.7 8 8.4l2.1-2.7M8 8.4V11M6.3 9.4h3.4' }),
      )
    }

    /**
     * The sidebar row glyph. The shell owns the button, label, tooltip and rail
     * geometry; this draws only the glyph at the size it asks for.
     * @param {{ size: number, active: boolean }} props - the shell's icon share.
     * @returns {React.ReactElement} the glyph.
     */
    function CreditsPanelIcon({ size }) {
      return h(
        'svg',
        {
          'data-dsh-panel-entry': PANEL_ID,
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('circle', { key: 'coin', cx: 8, cy: 8, r: 6 }),
        h('path', { key: 'mark', d: 'M5.9 5.7 8 8.4l2.1-2.7M8 8.4V11M6.3 9.4h3.4' }),
      )
    }

    /**
     * Load the last known value once, then expose the on-demand refresh.
     * @returns {{ view: { phase: string, state: any, failure: string | null }, busy: boolean, refresh: () => void }} panel state.
     */
    function useCredits() {
      const [view, setView] = React.useState({ phase: 'loading', state: null, failure: null })
      const [busy, setBusy] = React.useState(false)
      const alive = React.useRef(true)
      React.useEffect(() => () => {
        alive.current = false
      }, [])
      React.useEffect(() => {
        loadState().then(
          (state) => {
            if (alive.current) setView({ phase: 'ready', state, failure: null })
          },
          (error) => {
            if (alive.current) setView({ phase: 'failed', state: null, failure: error.code })
          },
        )
      }, [])
      const refresh = React.useCallback(() => {
        setBusy(true)
        refreshState()
          .then(
            (state) => {
              if (alive.current) setView({ phase: 'ready', state, failure: null })
            },
            (error) => {
              if (!alive.current) return
              // A transport failure keeps whatever value was already on screen.
              setView((current) => ({
                phase: current.state === null ? 'failed' : 'ready',
                state: current.state,
                failure: error.code,
              }))
            },
          )
          .finally(() => {
            if (alive.current) setBusy(false)
          })
      }, [])
      return { view, busy, refresh }
    }

    /**
     * The card body for the current phase.
     * @param {any} props - phase, totals and wording inputs.
     * @returns {React.ReactNode} the body.
     */
    function CardBody(props) {
      const { t, view, totals, updatedAt, lastFailure, available } = props
      if (view.phase === 'loading') return h('p', { className: 'muted' }, t('status.loading'))
      if (view.phase === 'failed') {
        return h(
          'div',
          { className: 'block error', role: 'status' },
          h('strong', null, t('error.title')),
          h('p', null, failureText(t, view.failure)),
        )
      }
      const parts = []
      if (lastFailure !== null) {
        parts.push(
          h(
            'div',
            { className: 'block warn', role: 'status', key: 'warning' },
            h('strong', null, t('warning.title')),
            h('p', null, updatedAt === null ? t('warning.no_value') : t('warning.stale', { at: formatTime(updatedAt) })),
            h('p', null, failureText(t, lastFailure.code)),
          ),
        )
      }
      if (totals.length === 0) {
        parts.push(
          h(
            'div',
            { className: 'block', key: 'empty' },
            h('strong', null, t('empty.title')),
            h('p', null, t('empty.body')),
          ),
        )
      } else {
        parts.push(
          h(
            'div',
            { className: 'wallets', key: 'wallets' },
            totals.map((total) =>
              h(
                'div',
                { className: 'wallet', key: total.currency },
                h('div', { className: 'amount' }, formatAmount(total.total, total.currency)),
                h(
                  'div',
                  { className: 'breakdown' },
                  h('span', null, `${t('wallet.topped_up')} ${formatAmount(total.toppedUp, total.currency)}`),
                  h('span', { className: 'dot', 'aria-hidden': 'true' }, '·'),
                  h('span', null, `${t('wallet.granted')} ${formatAmount(total.granted, total.currency)}`),
                ),
              ),
            ),
          ),
        )
      }
      if (available === false) {
        parts.push(h('p', { className: 'notice', key: 'notice' }, t('notice.insufficient')))
      }
      return h(React.Fragment, null, parts)
    }

    /**
     * The main-area page: current balance, when it was read, and the refresh.
     * @param {{ t: Function, locale: any }} props - injected wording and locale.
     * @returns {React.ReactElement} the page.
     */
    function CreditsPanel({ t, locale }) {
      useLocaleRevision(locale)
      const { view, busy, refresh } = useCredits()
      const state = view.state
      const totals = totalsByCurrency(walletsOf(state))
      const updatedAt = state !== null && typeof state === 'object' && typeof state.updatedAt === 'string'
        ? state.updatedAt
        : null
      const lastFailure = state !== null && typeof state === 'object'
        && state.lastFailure !== null && typeof state.lastFailure === 'object'
        ? state.lastFailure
        : null
      const available = state !== null && typeof state === 'object' && typeof state.available === 'boolean'
        ? state.available
        : null
      return h(
        'div',
        { 'data-dsh-credits-view': '', 'data-dsh-plugin': 'dsh-credits' },
        h('style', { key: 'styles' }, STYLES),
        h(
          'div',
          { className: 'page', key: 'page' },
          h(
            'header',
            { className: 'head' },
            h('span', { className: 'glyph' }, h(CoinGlyph, { size: 18 })),
            h(
              'div',
              { className: 'head-text' },
              h('h1', null, t('page.title')),
              h('p', { className: 'sub' }, t('page.subtitle')),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'btn primary',
                onClick: refresh,
                disabled: busy,
                'aria-busy': busy ? 'true' : 'false',
              },
              busy ? t('action.refreshing') : t('action.refresh'),
            ),
          ),
          h(
            'section',
            { className: 'card', 'aria-busy': busy ? 'true' : 'false' },
            h(CardBody, { t, view, totals, updatedAt, lastFailure, available }),
            view.phase === 'loading' ? null : h(
              'div',
              { className: 'foot' },
              h(
                'span',
                { 'aria-live': 'polite' },
                updatedAt === null ? t('status.never_refreshed') : t('status.updated_at', { at: formatTime(updatedAt) }),
              ),
            ),
          ),
        ),
      )
    }

    /**
     * Register the sidebar row, the page and this plugin's dictionaries.
     * @param {any} ctx - client plugin context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      for (const [id, dict] of Object.entries({ en: EN, fr: FR, zh: ZH })) {
        ctx.effect(() => ctx.locale.register(NS, id, dict))
      }
      ctx.effect(() =>
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: PANEL_ORDER,
              // The shell re-resolves this on every locale change.
              label: () => t('entry.label'),
            },
            CreditsPanelIcon,
          ),
        ),
      )
      ctx.effect(() =>
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              inject: () => ({ t, locale: ctx.locale }),
            },
            CreditsPanel,
          ),
        ),
      )
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
