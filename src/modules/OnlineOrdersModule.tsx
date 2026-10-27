import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import { supabase } from '../lib/supabase'

type OnlineOrdersModuleProps = {
  roleCode: string
}

type Pedido = {
  id: number
  numero: string
  cliente_nombre: string
  telefono: string | null
  correo: string | null
  modalidad_entrega: string
  direccion_entrega: string | null
  metodo_pago: string | null
  total: number
  estado: string
  observaciones: string | null
  motivo_estado: string | null
  venta_id: number | null
  created_at: string
  gestionado_at: string | null
}

type DetallePedido = {
  id: number
  producto_id: number
  cantidad: number
  precio_unitario: number
  subtotal: number
  productos:
    | { codigo: string; nombre: string }
    | { codigo: string; nombre: string }[]
    | null
}

type AccionPedido =
  | 'confirmado'
  | 'preparado'
  | 'rechazado'
  | 'cancelado'

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
    recibido: 'Recibido',
    confirmado: 'Confirmado',
    preparado: 'Preparado',
    convertido: 'Convertido en venta',
    rechazado: 'Rechazado',
    cancelado: 'Cancelado',
  }
  return mapa[estado] ?? estado
}

function etiquetaMetodoPago(metodo: string | null) {
  const mapa: Record<string, string> = {
    efectivo: 'Efectivo',
    tarjeta: 'Tarjeta',
    transferencia: 'Transferencia',
  }
  return metodo ? mapa[metodo] ?? metodo : 'No indicada'
}

function claseEstado(estado: string) {
  if (estado === 'convertido') {
    return 'history-status history-status--ok'
  }
  if (estado === 'rechazado' || estado === 'cancelado') {
    return 'history-status history-status--danger'
  }
  return 'history-status history-status--pending'
}

/*
 * Transiciones permitidas. Deben coincidir con
 * cambiar_estado_pedido_web() en la base de datos.
 */
function accionesDisponibles(estado: string): AccionPedido[] {
  if (estado === 'recibido') return ['confirmado', 'rechazado']
  if (estado === 'confirmado') return ['preparado', 'cancelado']
  if (estado === 'preparado') return ['cancelado']
  return []
}

const etiquetaAccion: Record<AccionPedido, string> = {
  confirmado: 'Confirmar pedido',
  preparado: 'Marcar como preparado',
  rechazado: 'Rechazar',
  cancelado: 'Cancelar pedido',
}

export default function OnlineOrdersModule({
  roleCode,
}: OnlineOrdersModuleProps) {
  const puedeConsultar = [
    'vendedor',
    'responsable_comercial',
    'marketing_digital',
    'gerencia',
  ].includes(roleCode)

  const puedeGestionar =
    roleCode === 'vendedor' ||
    roleCode === 'marketing_digital'

  const puedeConvertir =
    roleCode === 'vendedor'

  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [pedidoSeleccionado, setPedidoSeleccionado] =
    useState<Pedido | null>(null)
  const [detalle, setDetalle] = useState<DetallePedido[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [estado, setEstado] = useState('pendientes')
  const [motivo, setMotivo] = useState('')
  const [accionConMotivo, setAccionConMotivo] =
    useState<AccionPedido | null>(null)
  const [cargando, setCargando] = useState(true)
  const [cargandoDetalle, setCargandoDetalle] = useState(false)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  const pedidosFiltrados = useMemo(() => {
    const termino = busqueda.trim().toLowerCase()

    return pedidos.filter(pedido => {
      const coincideBusqueda =
        !termino ||
        pedido.numero.toLowerCase().includes(termino) ||
        pedido.cliente_nombre.toLowerCase().includes(termino) ||
        (pedido.correo ?? '').toLowerCase().includes(termino) ||
        (pedido.telefono ?? '').toLowerCase().includes(termino)

      const coincideEstado =
        estado === 'todos' ||
        (estado === 'pendientes'
          ? ['recibido', 'confirmado', 'preparado'].includes(pedido.estado)
          : pedido.estado === estado)

      return coincideBusqueda && coincideEstado
    })
  }, [pedidos, busqueda, estado])

  const resumen = useMemo(
    () => ({
      recibidos: pedidos.filter(p => p.estado === 'recibido').length,
      enProceso: pedidos.filter(
        p => p.estado === 'confirmado' || p.estado === 'preparado',
      ).length,
      convertidos: pedidos.filter(p => p.estado === 'convertido').length,
      cerrados: pedidos.filter(
        p => p.estado === 'rechazado' || p.estado === 'cancelado',
      ).length,
    }),
    [pedidos],
  )

  async function cargarPedidos() {
    if (!puedeConsultar) {
      setCargando(false)
      return
    }

    setCargando(true)
    setError('')

    const { data, error: pedidosError } =
      await supabase
        .from('pedidos_en_linea')
        .select(`
          id,
          numero,
          cliente_nombre,
          telefono,
          correo,
          modalidad_entrega,
          direccion_entrega,
          metodo_pago,
          total,
          estado,
          observaciones,
          motivo_estado,
          venta_id,
          created_at,
          gestionado_at
        `)
        .order('created_at', { ascending: false })

    if (pedidosError) {
      setError(pedidosError.message)
      setPedidos([])
      setCargando(false)
      return
    }

    const lista = (data ?? []).map(item => ({
      ...item,
      id: Number(item.id),
      total: Number(item.total ?? 0),
      venta_id: item.venta_id === null ? null : Number(item.venta_id),
    })) as Pedido[]

    setPedidos(lista)

    setPedidoSeleccionado(actual =>
      actual
        ? lista.find(p => p.id === actual.id) ?? null
        : null,
    )

    setCargando(false)
  }

  useEffect(() => {
    void cargarPedidos()
  }, [roleCode])

  async function verDetalle(pedido: Pedido) {
    setPedidoSeleccionado(pedido)
    setDetalle([])
    setAccionConMotivo(null)
    setMotivo('')
    setCargandoDetalle(true)
    setError('')
    setExito('')

    const { data, error: detalleError } =
      await supabase
        .from('detalle_pedidos_en_linea')
        .select(`
          id,
          producto_id,
          cantidad,
          precio_unitario,
          subtotal,
          productos (
            codigo,
            nombre
          )
        `)
        .eq('pedido_id', pedido.id)
        .order('id', { ascending: true })

    if (detalleError) {
      setError(detalleError.message)
      setCargandoDetalle(false)
      return
    }

    setDetalle((data ?? []) as unknown as DetallePedido[])
    setCargandoDetalle(false)
  }

  async function cambiarEstado(accion: AccionPedido) {
    if (!pedidoSeleccionado || !puedeGestionar) return

    const requiereMotivo =
      accion === 'rechazado' || accion === 'cancelado'

    if (requiereMotivo && accionConMotivo !== accion) {
      setAccionConMotivo(accion)
      setMotivo('')
      return
    }

    if (requiereMotivo && motivo.trim().length < 3) {
      setError('Indica un motivo de al menos 3 caracteres.')
      return
    }

    setProcesando(true)
    setError('')
    setExito('')

    const { error: rpcError } = await supabase.rpc(
      'cambiar_estado_pedido_web',
      {
        p_pedido_id: pedidoSeleccionado.id,
        p_estado: accion,
        p_motivo: requiereMotivo ? motivo.trim() : null,
      },
    )

    if (rpcError) {
      setError(rpcError.message)
      setProcesando(false)
      return
    }

    setExito(
      `Pedido ${pedidoSeleccionado.numero}: ${etiquetaEstado(accion).toLowerCase()}.`,
    )
    setAccionConMotivo(null)
    setMotivo('')
    await cargarPedidos()
    setProcesando(false)
  }

  async function convertirEnVenta() {
    if (!pedidoSeleccionado || !puedeConvertir) return

    setProcesando(true)
    setError('')
    setExito('')

    const { data, error: rpcError } = await supabase.rpc(
      'convertir_pedido_web_en_venta',
      { p_pedido_id: pedidoSeleccionado.id },
    )

    if (rpcError) {
      setError(rpcError.message)
      setProcesando(false)
      return
    }

    const fila = Array.isArray(data) ? data[0] : data

    setExito(
      `Pedido ${pedidoSeleccionado.numero} convertido en la venta ${fila?.venta_numero ?? ''}. Queda pendiente de cobro en Caja.`,
    )
    await cargarPedidos()
    setProcesando(false)
  }

  if (!puedeConsultar) {
    return (
      <div className="inventory-error">
        Este perfil no tiene acceso a los pedidos en línea.
      </div>
    )
  }

  if (cargando) {
    return (
      <div className="inventory-loading">
        <div className="inventory-spinner" />
        <span>Cargando pedidos en línea...</span>
      </div>
    )
  }

  const acciones = pedidoSeleccionado
    ? accionesDisponibles(pedidoSeleccionado.estado)
    : []

  const sePuedeConvertir =
    puedeConvertir &&
    pedidoSeleccionado !== null &&
    pedidoSeleccionado.venta_id === null &&
    ['confirmado', 'preparado'].includes(pedidoSeleccionado.estado)

  return (
    <div className="history-module">
      <section className="history-toolbar">
        <div>
          <span className="panel-label">TIENDA EN LÍNEA</span>
          <h2>Pedidos en línea</h2>
          <p>
            {puedeGestionar
              ? 'Atiende los pedidos realizados desde la tienda: confirma, prepara y conviértelos en venta.'
              : 'Consulta los pedidos realizados desde la tienda en línea y su estado de atención.'}
          </p>
        </div>

        <button
          type="button"
          className="inventory-refresh-button"
          onClick={() => void cargarPedidos()}
        >
          ↻ Actualizar
        </button>
      </section>

      <div className="history-summary-grid">
        <article className="history-summary-card">
          <span>RECIBIDOS</span>
          <strong>{resumen.recibidos}</strong>
          <p>esperando atención</p>
        </article>

        <article className="history-summary-card">
          <span>EN PROCESO</span>
          <strong>{resumen.enProceso}</strong>
          <p>confirmados o preparados</p>
        </article>

        <article className="history-summary-card">
          <span>CONVERTIDOS</span>
          <strong>{resumen.convertidos}</strong>
          <p>pasaron a venta</p>
        </article>

        <article className="history-summary-card">
          <span>CERRADOS</span>
          <strong>{resumen.cerrados}</strong>
          <p>rechazados o cancelados</p>
        </article>
      </div>

      {error && <div className="inventory-error">{error}</div>}
      {exito && <div className="movement-success">{exito}</div>}

      {pedidoSeleccionado && (
        <section className="history-detail-card">
          <div className="history-detail-head">
            <div>
              <span className="panel-label">DETALLE DEL PEDIDO</span>
              <h3>{pedidoSeleccionado.numero}</h3>
              <p>
                {pedidoSeleccionado.cliente_nombre}
                {pedidoSeleccionado.telefono
                  ? ` · ${pedidoSeleccionado.telefono}`
                  : ''}
                {pedidoSeleccionado.correo
                  ? ` · ${pedidoSeleccionado.correo}`
                  : ''}
              </p>
            </div>

            <button
              type="button"
              className="product-close-button"
              onClick={() => {
                setPedidoSeleccionado(null)
                setDetalle([])
                setAccionConMotivo(null)
              }}
            >
              ×
            </button>
          </div>

          <div className="history-detail-summary history-detail-summary--seis">
            <div>
              <span>ESTADO</span>
              <strong>{etiquetaEstado(pedidoSeleccionado.estado)}</strong>
            </div>

            <div>
              <span>ENTREGA</span>
              <strong>
                {pedidoSeleccionado.modalidad_entrega === 'domicilio'
                  ? 'A domicilio'
                  : 'Retiro en tienda'}
              </strong>
            </div>

            <div>
              <span>FORMA DE PAGO</span>
              <strong>{etiquetaMetodoPago(pedidoSeleccionado.metodo_pago)}</strong>
            </div>

            <div>
              <span>FECHA</span>
              <strong>{formatearFecha(pedidoSeleccionado.created_at)}</strong>
            </div>

            <div>
              <span>ÚLTIMA GESTIÓN</span>
              <strong>{formatearFecha(pedidoSeleccionado.gestionado_at)}</strong>
            </div>

            <div>
              <span>TOTAL</span>
              <strong>{formatearCordobas(pedidoSeleccionado.total)}</strong>
            </div>
          </div>

          {pedidoSeleccionado.modalidad_entrega === 'domicilio' &&
            pedidoSeleccionado.direccion_entrega && (
              <div className="history-origin-note">
                Dirección de entrega:{' '}
                <strong>{pedidoSeleccionado.direccion_entrega}</strong>
              </div>
            )}

          {pedidoSeleccionado.observaciones && (
            <div className="history-origin-note">
              Observaciones del cliente:{' '}
              <strong>{pedidoSeleccionado.observaciones}</strong>
            </div>
          )}

          {pedidoSeleccionado.motivo_estado && (
            <div className="history-cancel-note">
              Motivo: <strong>{pedidoSeleccionado.motivo_estado}</strong>
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
                    <th>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {detalle.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="inventory-empty">
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

          {puedeGestionar && (acciones.length > 0 || sePuedeConvertir) && (
            <>
              {accionConMotivo && (
                <div className="cash-form">
                  <label className="cash-field-full">
                    Motivo ({etiquetaAccion[accionConMotivo].toLowerCase()})
                    <textarea
                      value={motivo}
                      onChange={event => setMotivo(event.target.value)}
                      placeholder="Explica al cliente por qué no se atenderá el pedido"
                    />
                  </label>
                </div>
              )}

              <div className="product-form-actions">
                {acciones.map(accion => (
                  <button
                    key={accion}
                    type="button"
                    className={
                      accion === 'rechazado' || accion === 'cancelado'
                        ? 'product-secondary-button'
                        : 'product-primary-button'
                    }
                    disabled={procesando}
                    onClick={() => void cambiarEstado(accion)}
                  >
                    {accionConMotivo === accion
                      ? `Confirmar: ${etiquetaAccion[accion].toLowerCase()}`
                      : etiquetaAccion[accion]}
                  </button>
                ))}

                {sePuedeConvertir && (
                  <button
                    type="button"
                    className="product-primary-button"
                    disabled={procesando}
                    onClick={() => void convertirEnVenta()}
                  >
                    {procesando ? 'Procesando...' : 'Convertir en venta'}
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      )}

      <section className="history-list-card">
        <div className="history-list-head">
          <div>
            <span className="panel-label">REGISTRO</span>
            <h3>Pedidos recibidos</h3>
          </div>

          <span className="sales-result-count">
            {pedidosFiltrados.length}{' '}
            resultado{pedidosFiltrados.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="history-filters">
          <div className="clients-search">
            <span>⌕</span>
            <input
              type="text"
              value={busqueda}
              onChange={event => setBusqueda(event.target.value)}
              placeholder="Buscar por número, cliente, correo o teléfono..."
            />
          </div>

          <select
            value={estado}
            onChange={event => setEstado(event.target.value)}
          >
            <option value="pendientes">Pendientes de atención</option>
            <option value="todos">Todos los estados</option>
            <option value="recibido">Recibido</option>
            <option value="confirmado">Confirmado</option>
            <option value="preparado">Preparado</option>
            <option value="convertido">Convertido en venta</option>
            <option value="rechazado">Rechazado</option>
            <option value="cancelado">Cancelado</option>
          </select>
        </div>

        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Entrega</th>
                <th>Total</th>
                <th>Estado</th>
                <th>Fecha</th>
                <th>Acciones</th>
              </tr>
            </thead>

            <tbody>
              {pedidosFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={7} className="inventory-empty">
                    No se encontraron pedidos.
                  </td>
                </tr>
              ) : (
                pedidosFiltrados.map(pedido => (
                  <tr key={pedido.id}>
                    <td><strong>{pedido.numero}</strong></td>

                    <td>
                      {pedido.cliente_nombre}
                      {pedido.telefono && <small>{pedido.telefono}</small>}
                    </td>

                    <td>
                      <span
                        className={
                          pedido.modalidad_entrega === 'domicilio'
                            ? 'history-channel history-channel--online'
                            : 'history-channel'
                        }
                      >
                        {pedido.modalidad_entrega === 'domicilio'
                          ? 'Domicilio'
                          : 'Retiro'}
                      </span>
                    </td>

                    <td>
                      <strong>{formatearCordobas(pedido.total)}</strong>
                    </td>

                    <td>
                      <span className={claseEstado(pedido.estado)}>
                        {etiquetaEstado(pedido.estado)}
                      </span>
                    </td>

                    <td>{formatearFecha(pedido.created_at)}</td>

                    <td>
                      <button
                        type="button"
                        className="product-edit-button"
                        onClick={() => void verDetalle(pedido)}
                      >
                        {puedeGestionar &&
                        accionesDisponibles(pedido.estado).length > 0
                          ? 'Atender'
                          : 'Ver detalle'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
