/**
 * Browser half of the "Crédits restants" pill.
 *
 * One registration: a reading in the composer dock, beside the shell's own
 * activity and usage pills, so the remaining billing balance is visible while
 * chatting without opening any panel.
 *
 * The number is not computed here. The "Crédits restants DSH" panel's Host half
 * owns the provider read and keeps the last known value; this module only asks
 * its two exact routes over the Host's authenticated `/api` channel, exactly as
 * that panel's page does. Addresses stay document-relative so a sub-path mount
 * keeps working.
 *
 * @module @local/dsh-credits-pill
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-credits-pill',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace this plugin owns. */
    const NS = 'dsh-credits-pill'
    /** The credits panel's routes; that plugin holds the provider read. */
    const STATE_URL = 'api/dsh-credits-9d8b1b1d/state'
    const REFRESH_URL = 'api/dsh-credits-9d8b1b1d/refresh'
    /** Poll the last known value often; ask the provider to read it rarely. */
    const GET_INTERVAL_MS = 60 * 1000
    const REFRESH_INTERVAL_MS = 10 * 60 * 1000
    /** A value older than this is refreshed as soon as the pill mounts. */
    const STALE_MS = 5 * 60 * 1000

    /** @type {Record<string, string>} */
    const EN = {
      'pill.loading': 'Credits …',
      'pill.label': 'Credits',
      'pill.unavailable': 'Credits —',
      'pill.title': 'Remaining billing balance of the account DSH uses',
      'pill.updated': 'Last read: {at}',
    }

    /** @type {Record<string, string>} */
    const FR = {
      'pill.loading': 'Crédits …',
      'pill.label': 'Crédits',
      'pill.unavailable': 'Crédits —',
      'pill.title': 'Solde de facturation restant du compte utilisé par DSH',
      'pill.updated': 'Dernière lecture : {at}',
    }

    /** @type {Record<string, string>} */
    const ZH = {
      'pill.loading': '额度 …',
      'pill.label': '剩余额度',
      'pill.unavailable': '额度 —',
      'pill.title': 'DSH 所用账户的剩余计费余额',
      'pill.updated': '上次读取：{at}',
    }

    /** Fallback wording when the slot omits a translate for some reason. */
    function fallbackText(key, params) {
      const template = FR[key] ?? key
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/g, (match, name) => String(params[name] ?? match))
    }

    /** Read one JSON answer from the credits panel's Host half. */
    async function readJson(url, init) {
      const response = await fetch(url, { ...init, cache: 'no-store', credentials: 'same-origin' })
      if (!response.ok) throw new Error(`credits route ${response.status}`)
      return response.json()
    }

    /** @param {any} state - state document, possibly null. */
    function updatedAtOf(state) {
      return state !== null && typeof state === 'object' && typeof state.updatedAt === 'string'
        ? state.updatedAt
        : null
    }

    /** @param {any} state - state document, possibly null. */
    function isStale(state) {
      const at = updatedAtOf(state)
      if (at === null) return true
      const read = new Date(at).getTime()
      return !Number.isFinite(read) || Date.now() - read > STALE_MS
    }

    /**
     * Per-currency totals, preserving each wallet's own amount and meaning.
     * @param {any} state - state document, possibly null.
     * @returns {Array<{ currency: string, total: number }>} totals.
     */
    function totalsOf(state) {
      const wallets = state !== null && typeof state === 'object' && Array.isArray(state.wallets) ? state.wallets : []
      const byCurrency = new Map()
      for (const wallet of wallets) {
        if (wallet === null || typeof wallet !== 'object' || typeof wallet.currency !== 'string' || wallet.currency === '') continue
        const bucket = byCurrency.get(wallet.currency) ?? { currency: wallet.currency, total: 0 }
        const total = Number(wallet.total)
        bucket.total += Number.isFinite(total) ? total : 0
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

    const PILL_STYLE = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      color: 'var(--dsw-alias-label-tertiary)',
      fontSize: '12px',
      lineHeight: '20px',
      whiteSpace: 'nowrap',
      fontVariantNumeric: 'tabular-nums',
    }

    /**
     * The dock reading: last known balance, its timestamp in the tooltip.
     * @param {{ t: Function }} props - wording from the slot.
     * @returns {React.ReactElement} the pill.
     */
    function CreditsPill(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackText
      const [state, setState] = React.useState(null)
      const [failed, setFailed] = React.useState(false)

      React.useEffect(() => {
        let cancelled = false
        const fetchState = () => readJson(STATE_URL, { method: 'GET', headers: { accept: 'application/json' } }).then(
          (next) => {
            if (cancelled) return null
            setState(next)
            setFailed(false)
            return next
          },
          () => {
            if (!cancelled) setFailed(true)
            return null
          },
        )
        const refreshNow = () => readJson(REFRESH_URL, { method: 'POST', headers: { accept: 'application/json' } }).then(
          (next) => {
            if (cancelled) return
            setState(next)
            setFailed(false)
          },
          () => {},
        )
        fetchState().then((next) => {
          if (!cancelled && isStale(next)) refreshNow()
        })
        const getTimer = setInterval(() => {
          fetchState()
        }, GET_INTERVAL_MS)
        const refreshTimer = setInterval(() => {
          refreshNow()
        }, REFRESH_INTERVAL_MS)
        return () => {
          cancelled = true
          clearInterval(getTimer)
          clearInterval(refreshTimer)
        }
      }, [])

      const totals = totalsOf(state)
      const amount = totals.length === 0 ? null : totals.map((total) => formatAmount(total.total, total.currency)).join(' / ')
      const at = updatedAtOf(state)

      let text
      if (amount !== null) text = `${t('pill.label')} ${amount}`
      else if (state === null && !failed) text = t('pill.loading')
      else text = t('pill.unavailable')

      const tooltip = at === null ? t('pill.title') : `${t('pill.title')} · ${t('pill.updated', { at: formatTime(at) })}`

      return h('span', { 'data-dsh-credits-pill': '', title: tooltip, style: PILL_STYLE }, text)
    }

    /**
     * Register the dock reading and this plugin's dictionaries.
     * @param {any} ctx - client plugin context.
     */
    function apply(ctx) {
      for (const [id, dict] of Object.entries({ en: EN, fr: FR, zh: ZH })) {
        ctx.effect(() => ctx.locale.register(NS, id, dict))
      }
      ctx.effect(() =>
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'credits-pill',
              order: 2,
              locale: NS,
            },
            CreditsPill,
          ),
        ),
      )
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
