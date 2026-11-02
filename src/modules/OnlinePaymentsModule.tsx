import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import { supabase } from '../lib/supabase'

/*
 * Caja → Pagos en línea.
 *
 * El Responsable de Caja revisa los comprobantes de transferencia de
 * los pedidos web (revisar_pago_pedido_web): al aprobarlo, el pedido
 * queda validado y el Vendedor puede pasarlo a despacho. También
 * registra los reembolsos de pedidos cancelados después de pagarse.
 * Los pagos con tarjeta (simulada) se aprueban solos y aparecen en el
 * historial.
 */

type PagoEnLinea = {
  pago_id: number
  estado: string
  metodo: string
  pedido_id: number
  pedido_numero: string
  pedido_estado: string
  cliente_nombre: string
  cliente_cedula: string | null
  total: number
  moneda: string
  monto_moneda: number
  tipo_cambio: number | null
  banco: string | null
  cuenta_numero: string | null
  comprobante_path: string | null
  referencia: string | null
  tarjeta_marca: string | null
  tarjeta_ultimos4: string | null
  autorizacion: string | null
  motivo: string | null
  created_at: string
  revisado_at: string | null
}

type Vista = 'revisar' | 'reembolsar' | 'historial'

const ESTADOS: Record<string, string> = {
  pendiente: 'Por revisar',
  aprobado: 'Aprobado',
  rechazado: 'Rechazado',
  por_reembolsar: 'Por reembolsar',
  reembolsado: 'Reembolsado',
}

function cordobas(valor: number) {
  return new Intl.NumberFormat('es-NI', { style: 'currency', currency: 'NIO', minimumFractionDigits: 2 }).format(valor)
}

function fecha(valor: string | null) {
  if (!valor) return '—'
  return new Intl.DateTimeFormat('es-NI', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(valor))
}

function montoPagado(pago: PagoEnLinea) {
  return pago.moneda === 'USD'
    ? `US$ ${Number(pago.monto_moneda).toFixed(2)} (${cordobas(pago.total)} a C$ ${Number(pago.tipo_cambio).toFixed(4)})`
    : cordobas(pago.total)
}

export default function OnlinePaymentsModule() {
  const [pagos, setPagos] = useState<PagoEnLinea[]>([])
  const [vista, setVista] = useState<Vista>('revisar')
  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [motivos, setMotivos] = useState<Record<number, string>>({})
  const [rechazando, setRechazando] = useState<number | null>(null)
  const [comprobantes, setComprobantes] = useState<Record<number, string>>({})

  function pedirPagos() {
    return supabase.rpc('pagos_en_linea_caja').then(({ data, error: rpcError }) => {
      setCargando(false)

      if (rpcError) {
        setError(rpcError.message)
        return
      }

      setPagos(((data ?? []) as PagoEnLinea[]).map(p => ({
        ...p,
        total: Number(p.total),
        monto_moneda: Number(p.monto_moneda),
      })))
    })
  }

  useEffect(() => {
    void pedirPagos()
  }, [])

  const porRevisar = useMemo(() => pagos.filter(p => p.estado === 'pendiente'), [pagos])
  const porReembolsar = useMemo(() => pagos.filter(p => p.estado === 'por_reembolsar'), [pagos])
  const historial = useMemo(() => pagos.filter(p => !['pendiente', 'por_reembolsar'].includes(p.estado)), [pagos])

  // El comprobante está en un bucket privado: enlace temporal de 5 minutos
  async function verComprobante(pago: PagoEnLinea) {
    if (!pago.comprobante_path) return

    const { data, error: urlError } = await supabase.storage
      .from('comprobantes')
      .createSignedUrl(pago.comprobante_path, 300)

    if (urlError || !data) {
      setError(`No se pudo abrir el comprobante: ${urlError?.message ?? ''}`)
      return
    }

    setComprobantes(actual => ({ ...actual, [pago.pago_id]: data.signedUrl }))
  }

  async function revisar(pago: PagoEnLinea, aprobar: boolean) {
    const motivo = (motivos[pago.pago_id] ?? '').trim()

    if (!aprobar && rechazando !== pago.pago_id) {
      setRechazando(pago.pago_id)
      return
    }

    if (!aprobar && motivo.length < 3) {
      setError('Indica por qué se rechaza el comprobante (el cliente lo verá).')
      return
    }

    setProcesando(pago.pago_id)
    setError('')
    setExito('')

    const { error: rpcError } = await supabase.rpc('revisar_pago_pedido_web', {
      p_pago_id: pago.pago_id,
      p_aprobar: aprobar,
      p_motivo: aprobar ? null : motivo,
    })

    setProcesando(null)

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    setExito(
      aprobar
        ? `Pago del pedido ${pago.pedido_numero} aprobado: el pedido quedó validado para despacho.`
        : `Comprobante del pedido ${pago.pedido_numero} rechazado. El cliente puede adjuntar otro.`,
    )
    setRechazando(null)
    await pedirPagos()
  }

  async function reembolsar(pago: PagoEnLinea) {
    const referencia = (motivos[pago.pago_id] ?? '').trim()

    if (referencia.length < 3) {
      setError('Indica la referencia del reembolso (número de transferencia o de anulación en el POS).')
      return
    }

    setProcesando(pago.pago_id)
    setError('')
    setExito('')

    const { error: rpcError } = await supabase.rpc('reembolsar_pago_pedido_web', {
      p_pago_id: pago.pago_id,
      p_referencia: referencia,
    })

    setProcesando(null)

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    setExito(`Reembolso del pedido ${pago.pedido_numero} registrado.`)
    await pedirPagos()
  }

  if (cargando) {
    return (
      <div className="inventory-loading">
        <div className="inventory-spinner" />
        <span>Cargando pagos en línea...</span>
      </div>
    )
  }

  const lista = vista === 'revisar' ? porRevisar : vista === 'reembolsar' ? porReembolsar : historial

  return (
    <div className="history-module">
      <section className="history-toolbar">
        <div>
          <span className="panel-label">CAJA</span>
          <h2>Pagos en línea</h2>
          <p>
            Revisa los comprobantes de transferencia de los pedidos de la tienda. Al aprobarlo, el pedido
            queda validado y el Vendedor lo pasa a despacho.
          </p>
        </div>

        <button type="button" className="inventory-refresh-button" onClick={() => void pedirPagos()}>
          ↻ Actualizar
        </button>
      </section>

      <div className="pagos-pestanas" role="tablist">
        <button type="button" role="tab" aria-selected={vista === 'revisar'} className={vista === 'revisar' ? 'is-activa' : ''} onClick={() => setVista('revisar')}>
          Por revisar <b>{porRevisar.length}</b>
        </button>
        <button type="button" role="tab" aria-selected={vista === 'reembolsar'} className={vista === 'reembolsar' ? 'is-activa' : ''} onClick={() => setVista('reembolsar')}>
          Por reembolsar <b>{porReembolsar.length}</b>
        </button>
        <button type="button" role="tab" aria-selected={vista === 'historial'} className={vista === 'historial' ? 'is-activa' : ''} onClick={() => setVista('historial')}>
          Historial
        </button>
      </div>

      {error && <div className="inventory-error">{error}</div>}
      {exito && <div className="movement-success">{exito}</div>}

      {lista.length === 0 ? (
        <div className="kardex-vacio">
          {vista === 'revisar'
            ? 'No hay comprobantes por revisar.'
            : vista === 'reembolsar'
              ? 'No hay reembolsos pendientes.'
              : 'Todavía no hay pagos revisados.'}
        </div>
      ) : vista === 'historial' ? (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Medio</th>
                <th>Monto</th>
                <th>Estado</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {lista.map(pago => (
                <tr key={pago.pago_id}>
                  <td><strong>{pago.pedido_numero}</strong></td>
                  <td>{pago.cliente_nombre}</td>
                  <td>
                    {pago.metodo === 'tarjeta'
                      ? `${pago.tarjeta_marca} ****${pago.tarjeta_ultimos4}`
                      : `${pago.banco} · ${pago.cuenta_numero}`}
                    {pago.motivo && <small>{pago.motivo}</small>}
                  </td>
                  <td>{montoPagado(pago)}</td>
                  <td><em className={`pedido-pago pedido-pago--${pago.estado}`}>{ESTADOS[pago.estado] ?? pago.estado}</em></td>
                  <td>{fecha(pago.revisado_at ?? pago.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="pagos-lista">
          {lista.map(pago => (
            <article key={pago.pago_id} className="pago-tarjeta">
              <div className="pago-cabeza">
                <div>
                  <strong>{pago.pedido_numero}</strong>
                  <span>{pago.cliente_nombre}{pago.cliente_cedula && ` · ${pago.cliente_cedula}`}</span>
                </div>
                <b>
                  {pago.moneda === 'USD' ? `US$ ${Number(pago.monto_moneda).toFixed(2)}` : cordobas(pago.total)}
                  {pago.moneda === 'USD' && (
                    <small>{cordobas(pago.total)} · TC {Number(pago.tipo_cambio).toFixed(4)}</small>
                  )}
                </b>
              </div>

              <dl className="pago-datos">
                <div>
                  <dt>Medio</dt>
                  <dd>
                    {pago.metodo === 'tarjeta'
                      ? `${pago.tarjeta_marca} ****${pago.tarjeta_ultimos4} · aut. ${pago.autorizacion}`
                      : `${pago.banco} · ${pago.cuenta_numero} (${pago.moneda === 'USD' ? 'dólares' : 'córdobas'})`}
                  </dd>
                </div>
                {pago.referencia && (
                  <div><dt>Referencia</dt><dd>{pago.referencia}</dd></div>
                )}
                <div><dt>Recibido</dt><dd>{fecha(pago.created_at)}</dd></div>
                {pago.motivo && (
                  <div><dt>Motivo</dt><dd>{pago.motivo}</dd></div>
                )}
              </dl>

              {vista === 'revisar' && pago.comprobante_path && (
                comprobantes[pago.pago_id] ? (
                  pago.comprobante_path.toLowerCase().endsWith('.pdf') ? (
                    <a className="pago-comprobante-enlace" href={comprobantes[pago.pago_id]} target="_blank" rel="noopener noreferrer">
                      Abrir comprobante (PDF)
                    </a>
                  ) : (
                    <a href={comprobantes[pago.pago_id]} target="_blank" rel="noopener noreferrer">
                      <img className="pago-comprobante" src={comprobantes[pago.pago_id]} alt={`Comprobante del pedido ${pago.pedido_numero}`} />
                    </a>
                  )
                ) : (
                  <button type="button" className="product-secondary-button" onClick={() => void verComprobante(pago)}>
                    Ver comprobante
                  </button>
                )
              )}

              {vista === 'revisar' && rechazando === pago.pago_id && (
                <label className="pago-motivo">
                  Motivo del rechazo (lo verá el cliente)
                  <input
                    value={motivos[pago.pago_id] ?? ''}
                    onChange={event => setMotivos(actual => ({ ...actual, [pago.pago_id]: event.target.value }))}
                    placeholder="Ej. El monto no coincide, el comprobante no se lee..."
                  />
                </label>
              )}

              {vista === 'reembolsar' && (
                <label className="pago-motivo">
                  Referencia del reembolso
                  <input
                    value={motivos[pago.pago_id] ?? ''}
                    onChange={event => setMotivos(actual => ({ ...actual, [pago.pago_id]: event.target.value }))}
                    placeholder="Número de transferencia o de anulación en el POS"
                  />
                </label>
              )}

              <div className="product-form-actions">
                {vista === 'revisar' ? (
                  <>
                    <button type="button" className="product-secondary-button" disabled={procesando === pago.pago_id} onClick={() => void revisar(pago, false)}>
                      {rechazando === pago.pago_id ? 'Confirmar rechazo' : 'Rechazar'}
                    </button>
                    <button type="button" className="product-primary-button" disabled={procesando === pago.pago_id} onClick={() => void revisar(pago, true)}>
                      {procesando === pago.pago_id ? 'Guardando...' : 'Aprobar pago'}
                    </button>
                  </>
                ) : (
                  <button type="button" className="product-primary-button" disabled={procesando === pago.pago_id} onClick={() => void reembolsar(pago)}>
                    {procesando === pago.pago_id ? 'Guardando...' : 'Registrar reembolso'}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
