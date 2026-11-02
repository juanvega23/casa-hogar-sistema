import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import { supabase } from '../lib/supabase'

/*
 * Pedidos de la tienda en línea.
 *
 * Flujo (cambiar_estado_pedido_web):
 *   pendiente_validacion → validado → en_despacho → entregado
 *
 * - Vendedor: valida los pedidos en efectivo, rechaza, cancela y pasa
 *   a despacho (ahí se crea la venta y se descuenta el inventario).
 *   Los pagos por transferencia los valida Caja; la tarjeta se valida
 *   sola al aprobarse.
 * - Bodega (almacen): ve los pedidos en despacho y marca la entrega.
 * - Responsable Comercial y Gerencia: consulta.
 */

type OnlineOrdersModuleProps = {
  roleCode: string
}

type Pedido = {
  id: number
  numero: string
  cliente_nombre: string
  telefono: string | null
  correo: string | null
  cliente_cedula: string | null
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
  despachado_at: string | null
  entregado_at: string | null
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

type PagoPedido = {
  id: number
  metodo: string
  estado: string
  monto: number
  moneda: string
  monto_moneda: number
  banco: string | null
  cuenta_numero: string | null
  referencia: string | null
  tarjeta_marca: string | null
  tarjeta_ultimos4: string | null
  autorizacion: string | null
  motivo: string | null
  created_at: string
}

type AccionPedido =
  | 'validado'
  | 'rechazado'
  | 'en_despacho'
  | 'entregado'
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

function etiquetaEstado(estado: string, modalidad?: string) {
  const mapa: Record<string, string> = {
    pendiente_validacion: 'Por validar',
    validado: 'Validado',
    en_despacho: 'En despacho',
    entregado: modalidad === 'retiro' ? 'Retirado' : 'Entregado',
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

const ESTADOS_PAGO: Record<string, string> = {
  pendiente: 'En revisión por Caja',
  aprobado: 'Aprobado',
  rechazado: 'Rechazado',
  por_reembolsar: 'Por reembolsar',
  reembolsado: 'Reembolsado',
}

function claseEstado(estado: string) {
  if (estado === 'entregado') return 'history-status history-status--ok'
  if (estado === 'rechazado' || estado === 'cancelado') return 'history-status history-status--danger'
  return 'history-status history-status--pending'
}

/*
 * Transiciones permitidas por rol. Deben coincidir con
 * cambiar_estado_pedido_web() en la base de datos.
 */
function accionesDisponibles(pedido: Pedido, roleCode: string): AccionPedido[] {
  if (roleCode === 'almacen') {
    return pedido.estado === 'en_despacho' ? ['entregado'] : []
  }

  if (roleCode !== 'vendedor') return []

  if (pedido.estado === 'pendiente_validacion') {
    return pedido.metodo_pago === 'efectivo'
      ? ['validado', 'rechazado', 'cancelado']
      : ['rechazado', 'cancelado']
  }

  if (pedido.estado === 'validado') return ['en_despacho', 'cancelado']

  return []
}

function etiquetaAccion(accion: AccionPedido, pedido: Pedido | null) {
  const mapa: Record<AccionPedido, string> = {
    validado: 'Validar pedido',
    rechazado: 'Rechazar',
    en_despacho: 'Pasar a despacho',
    entregado: pedido?.modalidad_entrega === 'retiro' ? 'Marcar como retirado' : 'Marcar como entregado',
    cancelado: 'Cancelar pedido',
  }
  return mapa[accion]
}

const FILTROS_POR_ROL: Record<string, string> = {
  almacen: 'en_despacho',
}

export default function OnlineOrdersModule({
  roleCode,
}: OnlineOrdersModuleProps) {
  const puedeConsultar = [
    'vendedor',
    'responsable_comercial',
    'gerencia',
    'almacen',
  ].includes(roleCode)

  const esBodega = roleCode === 'almacen'
  const puedeGestionar = roleCode === 'vendedor' || esBodega

  // Bodega no lee pagos: solo despacha
  const vePagos = !esBodega

  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [pedidoSeleccionado, setPedidoSeleccionado] =
    useState<Pedido | null>(null)
  const [detalle, setDetalle] = useState<DetallePedido[]>([])
  const [pagos, setPagos] = useState<PagoPedido[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [estado, setEstado] = useState(FILTROS_POR_ROL[roleCode] ?? 'pendientes')
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
        (pedido.telefono ?? '').toLowerCase().includes(termino) ||
        (pedido.cliente_cedula ?? '').toLowerCase().includes(termino)

      const coincideEstado =
        estado === 'todos' ||
        (estado === 'pendientes'
          ? ['pendiente_validacion', 'validado', 'en_despacho'].includes(pedido.estado)
          : pedido.estado === estado)

      return coincideBusqueda && coincideEstado
    })
  }, [pedidos, busqueda, estado])

  const resumen = useMemo(
    () => ({
      porValidar: pedidos.filter(p => p.estado === 'pendiente_validacion').length,
      validados: pedidos.filter(p => p.estado === 'validado').length,
      enDespacho: pedidos.filter(p => p.estado === 'en_despacho').length,
      entregados: pedidos.filter(p => p.estado === 'entregado').length,
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
          cliente_cedula,
          modalidad_entrega,
          direccion_entrega,
          metodo_pago,
          total,
          estado,
          observaciones,
          motivo_estado,
          venta_id,
          created_at,
          gestionado_at,
          despachado_at,
          entregado_at
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
    setPagos([])
    setAccionConMotivo(null)
    setMotivo('')
    setCargandoDetalle(true)
    setError('')
    setExito('')

    const [detalleResp, pagosResp] = await Promise.all([
      supabase
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
        .order('id', { ascending: true }),

      vePagos
        ? supabase
            .from('pagos_pedido_web')
            .select('id, metodo, estado, monto, moneda, monto_moneda, banco, cuenta_numero, referencia, tarjeta_marca, tarjeta_ultimos4, autorizacion, motivo, created_at')
            .eq('pedido_id', pedido.id)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ])

    if (detalleResp.error || pagosResp.error) {
      setError((detalleResp.error ?? pagosResp.error)!.message)
      setCargandoDetalle(false)
      return
    }

    setDetalle((detalleResp.data ?? []) as unknown as DetallePedido[])
    setPagos((pagosResp.data ?? []) as PagoPedido[])
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

    const numero = pedidoSeleccionado.numero

    setExito(
      accion === 'en_despacho'
        ? `Pedido ${numero} en despacho: se registró la venta y se descontó el inventario.${
            pedidoSeleccionado.metodo_pago === 'efectivo' ? ' El cobro queda pendiente en Caja.' : ' La venta ya quedó pagada.'
          }`
        : accion === 'cancelado' && pagos.some(p => p.estado === 'aprobado')
          ? `Pedido ${numero} cancelado. El pago queda por reembolsar en Caja.`
          : `Pedido ${numero}: ${etiquetaEstado(accion, pedidoSeleccionado.modalidad_entrega).toLowerCase()}.`,
    )
    setAccionConMotivo(null)
    setMotivo('')
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
    ? accionesDisponibles(pedidoSeleccionado, roleCode)
    : []

  // Aviso de qué falta cuando el Vendedor no puede validar a mano
  const esperaPago =
    roleCode === 'vendedor' &&
    pedidoSeleccionado?.estado === 'pendiente_validacion' &&
    pedidoSeleccionado.metodo_pago !== 'efectivo'

  return (
    <div className="history-module">
      <section className="history-toolbar">
        <div>
          <span className="panel-label">{esBodega ? 'BODEGA' : 'TIENDA EN LÍNEA'}</span>
          <h2>{esBodega ? 'Despachos' : 'Pedidos en línea'}</h2>
          <p>
            {esBodega
              ? 'Pedidos validados que ya pasaron a despacho: prepáralos y marca la entrega o el retiro.'
              : puedeGestionar
                ? 'Valida los pedidos de la tienda y pásalos a despacho. Al pasar a despacho se registra la venta y se descuenta el inventario.'
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
          <span>POR VALIDAR</span>
          <strong>{resumen.porValidar}</strong>
          <p>esperando pago o confirmación</p>
        </article>

        <article className="history-summary-card">
          <span>VALIDADOS</span>
          <strong>{resumen.validados}</strong>
          <p>listos para despacho</p>
        </article>

        <article className="history-summary-card">
          <span>EN DESPACHO</span>
          <strong>{resumen.enDespacho}</strong>
          <p>por entregar o retirar</p>
        </article>

        <article className="history-summary-card">
          <span>ENTREGADOS</span>
          <strong>{resumen.entregados}</strong>
          <p>completados</p>
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
              {/* Para verificar la identidad de quien retira o recibe */}
              <p>
                Cédula:{' '}
                <strong>{pedidoSeleccionado.cliente_cedula ?? 'No registrada (pedido anterior)'}</strong>
              </p>
            </div>

            <button
              type="button"
              className="product-close-button"
              onClick={() => {
                setPedidoSeleccionado(null)
                setDetalle([])
                setPagos([])
                setAccionConMotivo(null)
              }}
            >
              ×
            </button>
          </div>

          <div className="history-detail-summary history-detail-summary--seis">
            <div>
              <span>ESTADO</span>
              <strong>{etiquetaEstado(pedidoSeleccionado.estado, pedidoSeleccionado.modalidad_entrega)}</strong>
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
              <span>{pedidoSeleccionado.entregado_at ? 'ENTREGADO' : pedidoSeleccionado.despachado_at ? 'DESPACHADO' : 'ÚLTIMA GESTIÓN'}</span>
              <strong>
                {formatearFecha(
                  pedidoSeleccionado.entregado_at ??
                    pedidoSeleccionado.despachado_at ??
                    pedidoSeleccionado.gestionado_at,
                )}
              </strong>
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

          {vePagos && pagos.length > 0 && (
            <div className="pedido-pagos">
              <span className="panel-label">PAGOS</span>
              <ul>
                {pagos.map(pago => (
                  <li key={pago.id}>
                    <span>
                      <strong>
                        {pago.metodo === 'tarjeta'
                          ? `${pago.tarjeta_marca} ****${pago.tarjeta_ultimos4}`
                          : `${pago.banco} · ${pago.cuenta_numero}`}
                      </strong>
                      <small>
                        {formatearFecha(pago.created_at)}
                        {pago.moneda === 'USD' && ` · US$ ${Number(pago.monto_moneda).toFixed(2)}`}
                        {pago.autorizacion && ` · aut. ${pago.autorizacion}`}
                        {pago.referencia && ` · ref. ${pago.referencia}`}
                        {pago.motivo && ` · ${pago.motivo}`}
                      </small>
                    </span>
                    <em className={`pedido-pago pedido-pago--${pago.estado}`}>
                      {ESTADOS_PAGO[pago.estado] ?? pago.estado}
                    </em>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {esperaPago && (
            <div className="history-origin-note">
              {pedidoSeleccionado.metodo_pago === 'transferencia'
                ? pagos.some(p => p.estado === 'pendiente')
                  ? 'El comprobante está en revisión por Caja. El pedido se valida cuando Caja lo apruebe.'
                  : 'Falta que el cliente adjunte el comprobante de la transferencia.'
                : 'El cliente todavía no completa el pago con tarjeta.'}
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

          {puedeGestionar && acciones.length > 0 && (
            <>
              {accionConMotivo && (
                <div className="cash-form">
                  <label className="cash-field-full">
                    Motivo ({etiquetaAccion(accionConMotivo, pedidoSeleccionado).toLowerCase()})
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
                      ? `Confirmar: ${etiquetaAccion(accion, pedidoSeleccionado).toLowerCase()}`
                      : etiquetaAccion(accion, pedidoSeleccionado)}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      <section className="history-list-card">
        <div className="history-list-head">
          <div>
            <span className="panel-label">REGISTRO</span>
            <h3>{esBodega ? 'Pedidos para despachar' : 'Pedidos recibidos'}</h3>
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
              placeholder="Buscar por número, cliente, cédula, correo o teléfono..."
            />
          </div>

          <select
            value={estado}
            onChange={event => setEstado(event.target.value)}
          >
            <option value="pendientes">Pendientes de atención</option>
            <option value="todos">Todos los estados</option>
            <option value="pendiente_validacion">Por validar</option>
            <option value="validado">Validado</option>
            <option value="en_despacho">En despacho</option>
            <option value="entregado">Entregado o retirado</option>
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
                <th>Pago</th>
                <th>Total</th>
                <th>Estado</th>
                <th>Fecha</th>
                <th>Acciones</th>
              </tr>
            </thead>

            <tbody>
              {pedidosFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={8} className="inventory-empty">
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

                    <td>{etiquetaMetodoPago(pedido.metodo_pago)}</td>

                    <td>
                      <strong>{formatearCordobas(pedido.total)}</strong>
                    </td>

                    <td>
                      <span className={claseEstado(pedido.estado)}>
                        {etiquetaEstado(pedido.estado, pedido.modalidad_entrega)}
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
                        accionesDisponibles(pedido, roleCode).length > 0
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
