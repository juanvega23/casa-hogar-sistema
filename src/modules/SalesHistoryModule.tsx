import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import { supabase } from '../lib/supabase'
import Paginador from './Paginador'
import { usePaginacion } from '../lib/paginacion'
import FiltroFechas from './FiltroFechas'
import { enRangoDeFechas } from '../lib/filtroFechas'
import { consultaCompleta } from '../lib/consultaCompleta'
import FiltroColumna from './FiltroColumna'
import { opcionesDe } from '../lib/filtroColumna'

type SalesHistoryModuleProps = {
  roleCode: string
}

type Venta = {
  id: number
  numero: string
  cliente_nombre: string | null
  tipo_venta: string
  subtotal: number
  descuento: number
  total: number
  estado: string
  referencia: string | null
  created_at: string
  anulada_at: string | null
  motivo_anulacion: string | null
  canal: 'presencial' | 'en_linea'
  pedido_numero: string | null
}

type DetalleVenta = {
  id: number
  producto_id: number
  cantidad: number
  precio_unitario: number
  descuento_porcentaje: number
  subtotal: number
  productos:
    | { codigo: string; nombre: string }
    | { codigo: string; nombre: string }[]
    | null
}

function relacion<T>(valor: T | T[] | null): T | null {
  if (!valor) return null
  return Array.isArray(valor) ? valor[0] ?? null : valor
}

function formatearCordobas(valor: number) {
  return new Intl.NumberFormat('es-NI', {
    style: 'currency',
    currency: 'NIO',
    minimumFractionDigits: 2,
  }).format(valor)
}

function formatearFecha(valor: string | null) {
  if (!valor) return '—'
  return new Intl.DateTimeFormat('es-NI', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(valor))
}

function etiquetaEstado(estado: string) {
  const mapa: Record<string, string> = {
    pendiente_cobro: 'Pendiente de cobro',
    con_saldo: 'Con saldo',
    pagada: 'Pagada',
    anulada: 'Anulada',
    completada: 'Completada',
  }
  return mapa[estado] ?? estado
}

function claseEstado(estado: string) {
  if (estado === 'pagada' || estado === 'completada') {
    return 'history-status history-status--ok'
  }
  if (estado === 'anulada') {
    return 'history-status history-status--danger'
  }
  return 'history-status history-status--pending'
}

export default function SalesHistoryModule({
  roleCode,
}: SalesHistoryModuleProps) {
  const puedeConsultar =
    roleCode === 'vendedor' ||
    roleCode === 'responsable_comercial' ||
    roleCode === 'gerencia'

  const [ventas, setVentas] = useState<Venta[]>([])
  const [ventaSeleccionada, setVentaSeleccionada] =
    useState<Venta | null>(null)
  const [detalle, setDetalle] = useState<DetalleVenta[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [canal, setCanal] = useState('')
  const [tipo, setTipo] = useState('')
  const [estado, setEstado] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [cargando, setCargando] = useState(true)
  const [cargandoDetalle, setCargandoDetalle] = useState(false)
  const [error, setError] = useState('')

  const ventasFiltradas = useMemo(() => {
    const termino = busqueda.trim().toLowerCase()

    return ventas.filter(venta => {
      const coincideBusqueda =
        !termino ||
        venta.numero.toLowerCase().includes(termino) ||
        (venta.cliente_nombre ?? '').toLowerCase().includes(termino) ||
        (venta.referencia ?? '').toLowerCase().includes(termino) ||
        (venta.pedido_numero ?? '').toLowerCase().includes(termino)

      const coincideCanal =
        !canal || venta.canal === canal

      const coincideTipo =
        !tipo || venta.tipo_venta === tipo

      const coincideEstado =
        !estado || venta.estado === estado

      return coincideBusqueda && coincideCanal && coincideTipo && coincideEstado && enRangoDeFechas(venta.created_at, desde, hasta)
    })
  }, [ventas, busqueda, canal, tipo, estado, desde, hasta])

  const paginacion = usePaginacion(ventasFiltradas)

  const resumen = useMemo(
    () => ({
      total: ventas.length,
      presencial: ventas.filter(v => v.canal === 'presencial').length,
      enLinea: ventas.filter(v => v.canal === 'en_linea').length,
      anuladas: ventas.filter(v => v.estado === 'anulada').length,
    }),
    [ventas],
  )

  async function cargarVentas() {
    if (!puedeConsultar) {
      setCargando(false)
      return
    }

    setCargando(true)
    setError('')

    const { data: ventasData, error: ventasError } =
      await consultaCompleta((inicio, fin) => supabase
        .from('ventas')
        .select(`
          id,
          numero,
          cliente_nombre,
          tipo_venta,
          subtotal,
          descuento,
          total,
          estado,
          referencia,
          created_at,
          anulada_at,
          motivo_anulacion
        `)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(inicio, fin))

    if (ventasError) {
      setError(ventasError.message)
      setVentas([])
      setCargando(false)
      return
    }

    const ids = (ventasData ?? []).map(item => Number(item.id))
    let pedidosPorVenta = new Map<number, string>()

    if (ids.length > 0) {
      const { data: pedidosData, error: pedidosError } =
        await consultaCompleta((inicio, fin) => supabase
          .from('pedidos_en_linea')
          .select(`numero, venta_id`)
          .not('venta_id', 'is', null)
          .order('id', { ascending: true })
          .range(inicio, fin))

      if (!pedidosError) {
        pedidosPorVenta = new Map(
          (pedidosData ?? [])
            .filter(item => item.venta_id !== null)
            .map(item => [
              Number(item.venta_id),
              String(item.numero),
            ]),
        )
      }
    }

    setVentas(
      (ventasData ?? []).map(item => {
        const id = Number(item.id)
        const pedidoNumero = pedidosPorVenta.get(id) ?? null

        return {
          id,
          numero: String(item.numero),
          cliente_nombre: item.cliente_nombre,
          tipo_venta: String(item.tipo_venta),
          subtotal: Number(item.subtotal ?? 0),
          descuento: Number(item.descuento ?? 0),
          total: Number(item.total ?? 0),
          estado: String(item.estado),
          referencia: item.referencia,
          created_at: String(item.created_at),
          anulada_at: item.anulada_at,
          motivo_anulacion: item.motivo_anulacion,
          canal: pedidoNumero ? 'en_linea' : 'presencial',
          pedido_numero: pedidoNumero,
        }
      }),
    )

    setCargando(false)
  }

  useEffect(() => {
    void cargarVentas()
  }, [roleCode])

  async function verDetalle(venta: Venta) {
    setVentaSeleccionada(venta)
    setDetalle([])
    setCargandoDetalle(true)
    setError('')

    const { data, error: detalleError } =
      await supabase
        .from('detalle_ventas')
        .select(`
          id,
          producto_id,
          cantidad,
          precio_unitario,
          descuento_porcentaje,
          subtotal,
          productos (
            codigo,
            nombre
          )
        `)
        .eq('venta_id', venta.id)
        .order('id', { ascending: true })

    if (detalleError) {
      setError(detalleError.message)
      setCargandoDetalle(false)
      return
    }

    setDetalle((data ?? []) as unknown as DetalleVenta[])
    setCargandoDetalle(false)
  }

  if (!puedeConsultar) {
    return (
      <div className="inventory-error">
        Este perfil no tiene acceso al historial de ventas.
      </div>
    )
  }

  if (cargando) {
    return (
      <div className="inventory-loading">
        <div className="inventory-spinner" />
        <span>Cargando historial de ventas...</span>
      </div>
    )
  }

  return (
    <div className="history-module">
      <section className="history-toolbar">
        <div>
          <span className="panel-label">HISTORIAL</span>
          <h2>Historial de ventas</h2>
          <p>
            Consulta las ventas registradas, su origen y el detalle de cada operación.
          </p>
        </div>

        <button
          type="button"
          className="inventory-refresh-button"
          onClick={() => void cargarVentas()}
        >
          ↻ Actualizar
        </button>
      </section>

      <div className="history-summary-grid">
        <article className="history-summary-card">
          <span>TOTAL</span>
          <strong>{resumen.total}</strong>
          <p>ventas registradas</p>
        </article>

        <article className="history-summary-card">
          <span>PRESENCIALES</span>
          <strong>{resumen.presencial}</strong>
          <p>originadas en establecimiento</p>
        </article>

        <article className="history-summary-card">
          <span>EN LÍNEA</span>
          <strong>{resumen.enLinea}</strong>
          <p>originadas desde pedidos web</p>
        </article>

        <article className="history-summary-card">
          <span>ANULADAS</span>
          <strong>{resumen.anuladas}</strong>
          <p>operaciones anuladas</p>
        </article>
      </div>

      {error && (
        <div className="inventory-error">{error}</div>
      )}

      {ventaSeleccionada && (
        <section key={ventaSeleccionada.id} className="history-detail-card">
          <div className="history-detail-head">
            <div>
              <span className="panel-label">DETALLE DE VENTA</span>
              <h3>{ventaSeleccionada.numero}</h3>
              <p>{ventaSeleccionada.cliente_nombre ?? 'Cliente general'}</p>
            </div>

            <button
              type="button"
              className="product-close-button"
              onClick={() => {
                setVentaSeleccionada(null)
                setDetalle([])
              }}
            >
              ×
            </button>
          </div>

          <div className="history-detail-summary">
            <div>
              <span>CANAL</span>
              <strong>
                {ventaSeleccionada.canal === 'en_linea'
                  ? 'En línea'
                  : 'Presencial'}
              </strong>
            </div>

            <div>
              <span>TIPO</span>
              <strong>
                {ventaSeleccionada.tipo_venta === 'credito'
                  ? 'Crédito'
                  : 'Contado'}
              </strong>
            </div>

            <div>
              <span>ESTADO</span>
              <strong>{etiquetaEstado(ventaSeleccionada.estado)}</strong>
            </div>

            <div>
              <span>FECHA</span>
              <strong>{formatearFecha(ventaSeleccionada.created_at)}</strong>
            </div>

            <div>
              <span>TOTAL</span>
              <strong>{formatearCordobas(ventaSeleccionada.total)}</strong>
            </div>
          </div>

          {ventaSeleccionada.pedido_numero && (
            <div className="history-origin-note">
              Pedido en línea de origen:{' '}
              <strong>{ventaSeleccionada.pedido_numero}</strong>
            </div>
          )}

          {ventaSeleccionada.estado === 'anulada' &&
            ventaSeleccionada.motivo_anulacion && (
              <div className="history-cancel-note">
                Motivo de anulación:{' '}
                <strong>{ventaSeleccionada.motivo_anulacion}</strong>
              </div>
            )}

          {cargandoDetalle ? (
            <div className="history-detail-loading">
              Cargando detalle...
            </div>
          ) : (
            <div className="history-table-wrap">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Cantidad</th>
                    <th>Precio</th>
                    <th>Descuento</th>
                    <th>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {detalle.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="inventory-empty">
                        No hay detalle disponible.
                      </td>
                    </tr>
                  ) : (
                    detalle.map(item => {
                      const producto = relacion(item.productos)

                      return (
                        <tr key={item.id}>
                          <td>
                            <strong>{producto?.nombre ?? 'Producto'}</strong>
                            <small>{producto?.codigo ?? ''}</small>
                          </td>
                          <td>{Number(item.cantidad)}</td>
                          <td>{formatearCordobas(Number(item.precio_unitario))}</td>
                          <td>{Number(item.descuento_porcentaje ?? 0)}%</td>
                          <td>
                            <strong>{formatearCordobas(Number(item.subtotal))}</strong>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="history-list-card">
        <div className="history-list-head">
          <div>
            <span className="panel-label">REGISTRO</span>
            <h3>Ventas registradas</h3>
          </div>

          <span className="sales-result-count">
            {ventasFiltradas.length}{' '}
            resultado{ventasFiltradas.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="history-filters history-filters--fechas">
          <div className="clients-search">
            <span>⌕</span>
            <input
              type="text"
              value={busqueda}
              onChange={event => setBusqueda(event.target.value)}
              placeholder="Buscar por número, cliente, referencia o pedido..."
            />
          </div>

          <FiltroFechas desde={desde} hasta={hasta} onDesde={setDesde} onHasta={setHasta} />
        </div>

        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Venta</th>
                <th>Cliente</th>
                <FiltroColumna titulo="Canal" todos="Todos los canales" valor={canal} opciones={[['presencial', 'Presencial'], ['en_linea', 'En línea']]} onCambiar={setCanal} />
                <FiltroColumna titulo="Tipo" todos="Contado y crédito" valor={tipo} opciones={[['contado', 'Contado'], ['credito', 'Crédito']]} onCambiar={setTipo} />
                <th>Total</th>
                <FiltroColumna titulo="Estado" todos="Todos los estados" valor={estado} opciones={opcionesDe(ventas, v => v.estado, etiquetaEstado)} onCambiar={setEstado} />
                <th>Fecha</th>
                <th>Acciones</th>
              </tr>
            </thead>

            <tbody>
              {ventasFiltradas.length === 0 ? (
                <tr>
                  <td colSpan={8} className="inventory-empty">
                    No se encontraron ventas.
                  </td>
                </tr>
              ) : (
                paginacion.visibles.map(venta => (
                  <tr key={venta.id}>
                    <td>
                      <strong>{venta.numero}</strong>
                      {venta.pedido_numero && (
                        <small>{venta.pedido_numero}</small>
                      )}
                    </td>

                    <td>{venta.cliente_nombre ?? 'Cliente general'}</td>

                    <td>
                      <span
                        className={
                          venta.canal === 'en_linea'
                            ? 'history-channel history-channel--online'
                            : 'history-channel'
                        }
                      >
                        {venta.canal === 'en_linea' ? 'En línea' : 'Presencial'}
                      </span>
                    </td>

                    <td>
                      {venta.tipo_venta === 'credito' ? 'Crédito' : 'Contado'}
                    </td>

                    <td>
                      <strong>{formatearCordobas(venta.total)}</strong>
                    </td>

                    <td>
                      <span className={claseEstado(venta.estado)}>
                        {etiquetaEstado(venta.estado)}
                      </span>
                    </td>

                    <td>{formatearFecha(venta.created_at)}</td>

                    <td>
                      <button
                        type="button"
                        className="product-edit-button"
                        onClick={() => void verDetalle(venta)}
                      >
                        Ver detalle
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <Paginador control={paginacion} />
        </div>
      </section>
    </div>
  )
}
