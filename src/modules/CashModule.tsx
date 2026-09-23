import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import { supabase } from '../lib/supabase'

type MetodoPago =
  | 'efectivo'
  | 'tarjeta'
  | 'transferencia'

type PagoRespuesta = {
  metodo_pago: MetodoPago
  monto: number
  monto_recibido: number | null
  cambio: number
  referencia: string | null
}

type VentaRespuesta = {
  id: number
  numero: string
  cliente_nombre: string | null
  total: number
  estado: 'completada' | 'anulada'
  created_at: string
  motivo_anulacion: string | null

  pagos_venta:
    | PagoRespuesta
    | PagoRespuesta[]
    | null
}

type Venta = {
  id: number
  numero: string
  cliente: string
  total: number
  estado: 'completada' | 'anulada'
  fecha: string
  motivoAnulacion: string
  metodoPago: MetodoPago | null
  montoRecibido: number
  cambio: number
}

type MovimientoCaja = {
  id: number
  venta_id: number | null
  tipo: 'ingreso' | 'egreso' | 'ajuste'
  concepto: string
  metodo_pago: MetodoPago | null
  monto: number
  referencia: string | null
  created_at: string
}

type ProductoDetalleRelacion = {
  codigo: string
  nombre: string
}

type DetalleRespuesta = {
  id: number
  cantidad: number
  precio_unitario: number
  subtotal: number

  productos:
    | ProductoDetalleRelacion
    | ProductoDetalleRelacion[]
    | null
}

type DetalleVenta = {
  id: number
  codigo: string
  producto: string
  cantidad: number
  precio: number
  subtotal: number
}

function obtenerPago(
  pagos:
    | PagoRespuesta
    | PagoRespuesta[]
    | null,
) {
  if (!pagos) {
    return null
  }

  if (Array.isArray(pagos)) {
    return pagos[0] ?? null
  }

  return pagos
}

function obtenerProducto(
  relacion:
    | ProductoDetalleRelacion
    | ProductoDetalleRelacion[]
    | null,
) {
  if (!relacion) {
    return {
      codigo: '',
      nombre: 'Producto',
    }
  }

  if (Array.isArray(relacion)) {
    return (
      relacion[0] ?? {
        codigo: '',
        nombre: 'Producto',
      }
    )
  }

  return relacion
}

function formatearCordobas(
  valor: number,
) {
  return new Intl.NumberFormat(
    'es-NI',
    {
      style: 'currency',
      currency: 'NIO',
      minimumFractionDigits: 2,
    },
  ).format(valor)
}

function formatearFecha(
  fecha: string,
) {
  return new Intl.DateTimeFormat(
    'es-NI',
    {
      dateStyle: 'short',
      timeStyle: 'short',
    },
  ).format(
    new Date(fecha),
  )
}

function obtenerRangoHoy() {
  const ahora =
    new Date()

  const inicio =
    new Date(
      ahora.getFullYear(),
      ahora.getMonth(),
      ahora.getDate(),
      0,
      0,
      0,
      0,
    )

  const fin =
    new Date(
      ahora.getFullYear(),
      ahora.getMonth(),
      ahora.getDate(),
      23,
      59,
      59,
      999,
    )

  return {
    inicio:
      inicio.toISOString(),

    fin:
      fin.toISOString(),
  }
}

export default function CashModule() {
  const [
    ventas,
    setVentas,
  ] = useState<Venta[]>([])

  const [
    movimientos,
    setMovimientos,
  ] = useState<MovimientoCaja[]>([])

  const [
    busqueda,
    setBusqueda,
  ] = useState('')

  const [
    cargando,
    setCargando,
  ] = useState(true)

  const [
    procesando,
    setProcesando,
  ] = useState(false)

  const [
    error,
    setError,
  ] = useState('')

  const [
    exito,
    setExito,
  ] = useState('')

  const [
    ventaSeleccionada,
    setVentaSeleccionada,
  ] =
    useState<Venta | null>(
      null,
    )

  const [
    detalleVenta,
    setDetalleVenta,
  ] =
    useState<DetalleVenta[]>(
      [],
    )

  const [
    cargandoDetalle,
    setCargandoDetalle,
  ] =
    useState(false)

  async function cargarCaja() {
    setCargando(true)
    setError('')

    const {
      inicio,
      fin,
    } = obtenerRangoHoy()

    const [
      ventasResultado,
      movimientosResultado,
    ] =
      await Promise.all([
        supabase
          .from('ventas')
          .select(`
            id,
            numero,
            cliente_nombre,
            total,
            estado,
            created_at,
            motivo_anulacion,
            pagos_venta (
              metodo_pago,
              monto,
              monto_recibido,
              cambio,
              referencia
            )
          `)
          .order(
            'created_at',
            {
              ascending: false,
            },
          )
          .limit(50),

        supabase
          .from(
            'movimientos_caja',
          )
          .select(`
            id,
            venta_id,
            tipo,
            concepto,
            metodo_pago,
            monto,
            referencia,
            created_at
          `)
          .gte(
            'created_at',
            inicio,
          )
          .lte(
            'created_at',
            fin,
          )
          .order(
            'created_at',
            {
              ascending: false,
            },
          ),
      ])

    if (
      ventasResultado.error
    ) {
      setError(
        `No fue posible cargar las ventas: ${ventasResultado.error.message}`,
      )

      setCargando(false)
      return
    }

    if (
      movimientosResultado.error
    ) {
      setError(
        `No fue posible cargar los movimientos de caja: ${movimientosResultado.error.message}`,
      )

      setCargando(false)
      return
    }

    const respuesta =
      (ventasResultado.data ??
        []) as unknown as VentaRespuesta[]

    const ventasConvertidas =
      respuesta.map(
        (
          venta,
        ): Venta => {
          const pago =
            obtenerPago(
              venta.pagos_venta,
            )

          return {
            id:
              venta.id,

            numero:
              venta.numero,

            cliente:
              venta.cliente_nombre ||
              'Cliente general',

            total:
              Number(
                venta.total ?? 0,
              ),

            estado:
              venta.estado,

            fecha:
              venta.created_at,

            motivoAnulacion:
              venta.motivo_anulacion ??
              '',

            metodoPago:
              pago?.metodo_pago ??
              null,

            montoRecibido:
              Number(
                pago?.monto_recibido ??
                  pago?.monto ??
                  0,
              ),

            cambio:
              Number(
                pago?.cambio ?? 0,
              ),
          }
        },
      )

    setVentas(
      ventasConvertidas,
    )

    setMovimientos(
      (
        movimientosResultado.data ??
        []
      ).map(
        (
          movimiento,
        ): MovimientoCaja => ({
          id:
            movimiento.id,

          venta_id:
            movimiento.venta_id,

          tipo:
            movimiento.tipo,

          concepto:
            movimiento.concepto,

          metodo_pago:
            movimiento.metodo_pago,

          monto:
            Number(
              movimiento.monto ??
                0,
            ),

          referencia:
            movimiento.referencia,

          created_at:
            movimiento.created_at,
        }),
      ),
    )

    setCargando(false)
  }

  useEffect(() => {
    cargarCaja()
  }, [])

  const resumen =
    useMemo(() => {
      let ingresos = 0
      let egresos = 0
      let efectivo = 0
      let tarjeta = 0
      let transferencia = 0

      movimientos.forEach(
        (movimiento) => {
          const signo =
            movimiento.tipo ===
            'egreso'
              ? -1
              : 1

          if (
            movimiento.tipo ===
            'ingreso'
          ) {
            ingresos +=
              movimiento.monto
          }

          if (
            movimiento.tipo ===
            'egreso'
          ) {
            egresos +=
              movimiento.monto
          }

          if (
            movimiento.metodo_pago ===
            'efectivo'
          ) {
            efectivo +=
              movimiento.monto *
              signo
          }

          if (
            movimiento.metodo_pago ===
            'tarjeta'
          ) {
            tarjeta +=
              movimiento.monto *
              signo
          }

          if (
            movimiento.metodo_pago ===
            'transferencia'
          ) {
            transferencia +=
              movimiento.monto *
              signo
          }
        },
      )

      return {
        ingresos,
        egresos,
        neto:
          ingresos -
          egresos,
        efectivo,
        tarjeta,
        transferencia,
      }
    }, [movimientos])

  const ventasFiltradas =
    useMemo(() => {
      const termino =
        busqueda
          .trim()
          .toLowerCase()

      if (!termino) {
        return ventas
      }

      return ventas.filter(
        (venta) =>
          venta.numero
            .toLowerCase()
            .includes(termino) ||
          venta.cliente
            .toLowerCase()
            .includes(termino) ||
          venta.estado
            .toLowerCase()
            .includes(termino) ||
          (
            venta.metodoPago ??
            ''
          )
            .toLowerCase()
            .includes(termino),
      )
    }, [
      ventas,
      busqueda,
    ])

  const ventasHoy =
    useMemo(() => {
      const ahora =
        new Date()

      return ventas.filter(
        (venta) => {
          const fecha =
            new Date(
              venta.fecha,
            )

          return (
            fecha.getFullYear() ===
              ahora.getFullYear() &&
            fecha.getMonth() ===
              ahora.getMonth() &&
            fecha.getDate() ===
              ahora.getDate()
          )
        },
      )
    }, [ventas])

  const completadasHoy =
    ventasHoy.filter(
      (venta) =>
        venta.estado ===
        'completada',
    ).length

  const anuladasHoy =
    ventasHoy.filter(
      (venta) =>
        venta.estado ===
        'anulada',
    ).length

  async function verDetalle(
    venta: Venta,
  ) {
    setVentaSeleccionada(
      venta,
    )

    setDetalleVenta([])
    setCargandoDetalle(true)
    setError('')

    const {
      data,
      error,
    } =
      await supabase
        .from(
          'detalle_ventas',
        )
        .select(`
          id,
          cantidad,
          precio_unitario,
          subtotal,
          productos (
            codigo,
            nombre
          )
        `)
        .eq(
          'venta_id',
          venta.id,
        )
        .order(
          'id',
          {
            ascending: true,
          },
        )

    if (error) {
      setError(
        `No fue posible cargar el detalle de la venta: ${error.message}`,
      )

      setCargandoDetalle(false)
      return
    }

    const respuesta =
      (data ??
        []) as unknown as DetalleRespuesta[]

    setDetalleVenta(
      respuesta.map(
        (
          detalle,
        ): DetalleVenta => {
          const producto =
            obtenerProducto(
              detalle.productos,
            )

          return {
            id:
              detalle.id,

            codigo:
              producto.codigo,

            producto:
              producto.nombre,

            cantidad:
              Number(
                detalle.cantidad ??
                  0,
              ),

            precio:
              Number(
                detalle.precio_unitario ??
                  0,
              ),

            subtotal:
              Number(
                detalle.subtotal ??
                  0,
              ),
          }
        },
      ),
    )

    setCargandoDetalle(false)
  }

  function cerrarDetalle() {
    setVentaSeleccionada(
      null,
    )

    setDetalleVenta([])
  }

  async function anularVenta(
    venta: Venta,
  ) {
    if (
      venta.estado ===
      'anulada'
    ) {
      return
    }

    const motivo =
      window.prompt(
        `Motivo de anulación para ${venta.numero}:`,
        'Anulación solicitada desde Caja',
      )

    if (motivo === null) {
      return
    }

    if (
      motivo.trim().length <
      3
    ) {
      setError(
        'Debes indicar un motivo de anulación.',
      )

      return
    }

    const confirmar =
      window.confirm(
        `¿Confirmas la anulación de ${venta.numero} por ${formatearCordobas(venta.total)}?\n\nEl inventario será restaurado y se registrará un egreso de caja.`,
      )

    if (!confirmar) {
      return
    }

    setProcesando(true)
    setError('')
    setExito('')

    const { error } =
      await supabase.rpc(
        'anular_venta',
        {
          p_venta_id:
            venta.id,

          p_motivo:
            motivo.trim(),
        },
      )

    if (error) {
      setError(
        error.message,
      )

      setProcesando(false)
      return
    }

    setExito(
      `Venta ${venta.numero} anulada correctamente.`,
    )

    cerrarDetalle()

    await cargarCaja()

    setProcesando(false)
  }

  if (cargando) {
    return (
      <div className="inventory-loading">
        <div className="inventory-spinner" />

        <span>
          Cargando caja...
        </span>
      </div>
    )
  }

  return (
    <div className="cash-module">
      <div className="cash-toolbar">
        <div>
          <span className="panel-label">
            CONTROL DE CAJA
          </span>

          <h2>
            Caja
          </h2>

          <p>
            Resumen de ventas,
            ingresos, anulaciones y
            métodos de pago.
          </p>
        </div>

        <button
          type="button"
          className="inventory-refresh-button"
          onClick={
            cargarCaja
          }
        >
          ↻ Actualizar
        </button>
      </div>

      <div className="cash-summary-grid">
        <article className="cash-summary-card">
          <span>
            CAJA NETA HOY
          </span>

          <strong>
            {formatearCordobas(
              resumen.neto,
            )}
          </strong>

          <p>
            ingresos menos egresos
          </p>
        </article>

        <article className="cash-summary-card">
          <span>
            EFECTIVO
          </span>

          <strong>
            {formatearCordobas(
              resumen.efectivo,
            )}
          </strong>

          <p>
            saldo neto
          </p>
        </article>

        <article className="cash-summary-card">
          <span>
            TARJETA
          </span>

          <strong>
            {formatearCordobas(
              resumen.tarjeta,
            )}
          </strong>

          <p>
            saldo neto
          </p>
        </article>

        <article className="cash-summary-card">
          <span>
            TRANSFERENCIA
          </span>

          <strong>
            {formatearCordobas(
              resumen.transferencia,
            )}
          </strong>

          <p>
            saldo neto
          </p>
        </article>
      </div>

      <div className="cash-operation-strip">
        <div>
          <span>
            Ventas completadas hoy
          </span>

          <strong>
            {completadasHoy}
          </strong>
        </div>

        <div>
          <span>
            Ventas anuladas
          </span>

          <strong>
            {anuladasHoy}
          </strong>
        </div>

        <div>
          <span>
            Ingresos
          </span>

          <strong>
            {formatearCordobas(
              resumen.ingresos,
            )}
          </strong>
        </div>

        <div>
          <span>
            Egresos
          </span>

          <strong>
            {formatearCordobas(
              resumen.egresos,
            )}
          </strong>
        </div>
      </div>

      {error && (
        <div className="inventory-error">
          {error}
        </div>
      )}

      {exito && (
        <div className="movement-success">
          {exito}
        </div>
      )}

      <section className="cash-history-card">
        <div className="cash-history-head">
          <div>
            <span className="panel-label">
              HISTORIAL
            </span>

            <h3>
              Ventas recientes
            </h3>

            <p>
              Últimas operaciones
              registradas en el sistema.
            </p>
          </div>

          <span className="cash-result-count">
            {
              ventasFiltradas.length
            }{' '}
            venta
            {ventasFiltradas.length ===
            1
              ? ''
              : 's'}
          </span>
        </div>

        <div className="cash-search">
          <span>
            ⌕
          </span>

          <input
            type="text"
            value={
              busqueda
            }
            onChange={(
              event,
            ) =>
              setBusqueda(
                event.target
                  .value,
              )
            }
            placeholder="Buscar por número, cliente, estado o método de pago..."
          />
        </div>

        <div className="cash-table-container">
          <table className="cash-table">
            <thead>
              <tr>
                <th>
                  Venta
                </th>

                <th>
                  Fecha
                </th>

                <th>
                  Cliente
                </th>

                <th>
                  Método
                </th>

                <th>
                  Total
                </th>

                <th>
                  Estado
                </th>

                <th>
                  Acciones
                </th>
              </tr>
            </thead>

            <tbody>
              {ventasFiltradas.length >
              0 ? (
                ventasFiltradas.map(
                  (venta) => (
                    <tr
                      key={
                        venta.id
                      }
                    >
                      <td>
                        <strong className="cash-sale-number">
                          {
                            venta.numero
                          }
                        </strong>
                      </td>

                      <td>
                        {formatearFecha(
                          venta.fecha,
                        )}
                      </td>

                      <td>
                        {
                          venta.cliente
                        }
                      </td>

                      <td>
                        <span className="cash-payment-badge">
                          {venta.metodoPago
                            ? venta.metodoPago
                            : '—'}
                        </span>
                      </td>

                      <td>
                        <strong>
                          {formatearCordobas(
                            venta.total,
                          )}
                        </strong>
                      </td>

                      <td>
                        <span
                          className={
                            venta.estado ===
                            'completada'
                              ? 'cash-status cash-status--completed'
                              : 'cash-status cash-status--cancelled'
                          }
                        >
                          {
                            venta.estado
                          }
                        </span>
                      </td>

                      <td>
                        <div className="cash-actions">
                          <button
                            type="button"
                            className="cash-detail-button"
                            onClick={() =>
                              verDetalle(
                                venta,
                              )
                            }
                          >
                            Ver detalle
                          </button>

                          {venta.estado ===
                            'completada' && (
                            <button
                              type="button"
                              className="cash-cancel-button"
                              disabled={
                                procesando
                              }
                              onClick={() =>
                                anularVenta(
                                  venta,
                                )
                              }
                            >
                              Anular
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ),
                )
              ) : (
                <tr>
                  <td
                    colSpan={7}
                    className="inventory-empty"
                  >
                    No se encontraron
                    ventas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {ventaSeleccionada && (
        <section className="cash-detail-card">
          <div className="cash-detail-header">
            <div>
              <span className="panel-label">
                DETALLE DE VENTA
              </span>

              <h3>
                {
                  ventaSeleccionada.numero
                }
              </h3>

              <p>
                {formatearFecha(
                  ventaSeleccionada.fecha,
                )}
                {' · '}
                {
                  ventaSeleccionada.cliente
                }
              </p>
            </div>

            <button
              type="button"
              className="cash-close-button"
              onClick={
                cerrarDetalle
              }
            >
              ×
            </button>
          </div>

          <div className="cash-detail-summary">
            <div>
              <span>
                Estado
              </span>

              <strong>
                {
                  ventaSeleccionada.estado
                }
              </strong>
            </div>

            <div>
              <span>
                Método de pago
              </span>

              <strong>
                {
                  ventaSeleccionada.metodoPago ??
                  '—'
                }
              </strong>
            </div>

            <div>
              <span>
                Monto recibido
              </span>

              <strong>
                {formatearCordobas(
                  ventaSeleccionada.montoRecibido,
                )}
              </strong>
            </div>

            <div>
              <span>
                Cambio
              </span>

              <strong>
                {formatearCordobas(
                  ventaSeleccionada.cambio,
                )}
              </strong>
            </div>

            <div>
              <span>
                Total
              </span>

              <strong>
                {formatearCordobas(
                  ventaSeleccionada.total,
                )}
              </strong>
            </div>
          </div>

          {ventaSeleccionada.estado ===
            'anulada' &&
            ventaSeleccionada
              .motivoAnulacion && (
            <div className="cash-cancel-reason">
              <strong>
                Motivo de anulación:
              </strong>{' '}
              {
                ventaSeleccionada
                  .motivoAnulacion
              }
            </div>
          )}

          {cargandoDetalle ? (
            <div className="cash-detail-loading">
              Cargando detalle...
            </div>
          ) : (
            <div className="cash-table-container">
              <table className="cash-table">
                <thead>
                  <tr>
                    <th>
                      Código
                    </th>

                    <th>
                      Producto
                    </th>

                    <th>
                      Cantidad
                    </th>

                    <th>
                      Precio
                    </th>

                    <th>
                      Subtotal
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {detalleVenta.map(
                    (detalle) => (
                      <tr
                        key={
                          detalle.id
                        }
                      >
                        <td>
                          {
                            detalle.codigo
                          }
                        </td>

                        <td>
                          <strong>
                            {
                              detalle.producto
                            }
                          </strong>
                        </td>

                        <td>
                          {
                            detalle.cantidad
                          }
                        </td>

                        <td>
                          {formatearCordobas(
                            detalle.precio,
                          )}
                        </td>

                        <td>
                          <strong>
                            {formatearCordobas(
                              detalle.subtotal,
                            )}
                          </strong>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="cash-detail-footer">
            <strong>
              Total:{' '}
              {formatearCordobas(
                ventaSeleccionada.total,
              )}
            </strong>

            {ventaSeleccionada.estado ===
              'completada' && (
              <button
                type="button"
                className="cash-cancel-button"
                disabled={
                  procesando
                }
                onClick={() =>
                  anularVenta(
                    ventaSeleccionada,
                  )
                }
              >
                Anular venta
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  )
}