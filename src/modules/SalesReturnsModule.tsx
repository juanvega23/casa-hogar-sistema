import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import { supabase } from '../lib/supabase'


type SalesReturnsModuleProps = {
  roleCode: string
}


type Venta = {
  id: number
  numero: string
  cliente_nombre: string | null
  total: number
  estado: string
  tipo_venta: string
  created_at: string
}


type DetalleVenta = {
  producto_id: number
  cantidad: number
  precio_unitario: number
  subtotal: number
  productos:
    | {
        codigo: string
        nombre: string
      }
    | {
        codigo: string
        nombre: string
      }[]
    | null
}


type Devolucion = {
  id: number
  numero: string
  venta_id: number
  motivo: string
  total: number
  estado: string
  estado_financiero: string
  created_at: string
  confirmada_at: string | null
  observaciones: string | null
  ventas:
    | {
        numero: string
        cliente_nombre: string | null
      }
    | {
        numero: string
        cliente_nombre: string | null
      }[]
    | null
}


type DetalleDevolucion = {
  id: number
  producto_id: number
  cantidad: number
  precio_unitario: number
  subtotal: number
  destino: string | null
  observaciones: string | null
  productos:
    | {
        codigo: string
        nombre: string
      }
    | {
        codigo: string
        nombre: string
      }[]
    | null
}


type ItemRegistro = {
  producto_id: number
  codigo: string
  nombre: string
  cantidad_vendida: number
  cantidad_devuelta: number
  precio_unitario: number
}


type ItemConfirmacion = {
  producto_id: number
  codigo: string
  nombre: string
  cantidad: number
  destino: 'inventario' | 'merma'
}


function relacion<T>(
  valor: T | T[] | null,
): T | null {
  if (!valor) {
    return null
  }

  return Array.isArray(valor)
    ? valor[0] ?? null
    : valor
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
  valor: string | null,
) {
  if (!valor) {
    return '—'
  }

  return new Intl.DateTimeFormat(
    'es-NI',
    {
      dateStyle: 'short',
      timeStyle: 'short',
    },
  ).format(
    new Date(valor),
  )
}


function etiquetaEstado(
  estado: string,
) {
  const mapa: Record<
    string,
    string
  > = {
    registrada: 'Registrada',
    confirmada: 'Confirmada',
    anulada: 'Anulada',
  }

  return mapa[estado] ?? estado
}


function claseEstado(
  estado: string,
) {
  if (estado === 'confirmada') {
    return 'return-status return-status--ok'
  }

  if (estado === 'anulada') {
    return 'return-status return-status--danger'
  }

  return 'return-status return-status--pending'
}


export default function SalesReturnsModule({
  roleCode,
}: SalesReturnsModuleProps) {
  const puedeRegistrar =
    roleCode === 'vendedor'

  const puedeResolver =
    roleCode ===
    'responsable_comercial'

  const puedeConsultar =
    puedeRegistrar ||
    puedeResolver ||
    roleCode === 'gerencia'

  const [ventas, setVentas] =
    useState<Venta[]>([])

  const [devoluciones, setDevoluciones] =
    useState<Devolucion[]>([])

  const [ventaSeleccionada, setVentaSeleccionada] =
    useState('')

  const [itemsRegistro, setItemsRegistro] =
    useState<ItemRegistro[]>([])

  const [motivo, setMotivo] =
    useState('')

  const [observaciones, setObservaciones] =
    useState('')

  const [devolucionSeleccionada, setDevolucionSeleccionada] =
    useState<Devolucion | null>(
      null,
    )

  const [itemsConfirmacion, setItemsConfirmacion] =
    useState<ItemConfirmacion[]>(
      [],
    )

  const [busqueda, setBusqueda] =
    useState('')

  const [cargando, setCargando] =
    useState(true)

  const [procesando, setProcesando] =
    useState(false)

  const [error, setError] =
    useState('')

  const [exito, setExito] =
    useState('')


  const devolucionesFiltradas =
    useMemo(() => {
      const termino =
        busqueda
          .trim()
          .toLowerCase()

      if (!termino) {
        return devoluciones
      }

      return devoluciones.filter(
        devolucion => {
          const venta =
            relacion(
              devolucion.ventas,
            )

          return (
            devolucion.numero
              .toLowerCase()
              .includes(termino) ||
            devolucion.motivo
              .toLowerCase()
              .includes(termino) ||
            devolucion.estado
              .toLowerCase()
              .includes(termino) ||
            (
              venta?.numero ??
              ''
            )
              .toLowerCase()
              .includes(termino) ||
            (
              venta?.cliente_nombre ??
              ''
            )
              .toLowerCase()
              .includes(termino)
          )
        },
      )
    }, [
      devoluciones,
      busqueda,
    ])


  const resumen =
    useMemo(
      () => ({
        total:
          devoluciones.length,
        registradas:
          devoluciones.filter(
            item =>
              item.estado ===
              'registrada',
          ).length,
        confirmadas:
          devoluciones.filter(
            item =>
              item.estado ===
              'confirmada',
          ).length,
        anuladas:
          devoluciones.filter(
            item =>
              item.estado ===
              'anulada',
          ).length,
      }),
      [devoluciones],
    )


  async function cargarDatos() {
    if (!puedeConsultar) {
      setCargando(false)
      return
    }

    setCargando(true)
    setError('')

    const consultas: PromiseLike<any>[] = [
      supabase
        .from(
          'devoluciones_venta',
        )
        .select(`
          id,
          numero,
          venta_id,
          motivo,
          total,
          estado,
          estado_financiero,
          created_at,
          confirmada_at,
          observaciones,
          ventas (
            numero,
            cliente_nombre
          )
        `)
        .order(
          'created_at',
          {
            ascending: false,
          },
        ),
    ]

    if (puedeRegistrar) {
      consultas.push(
        supabase
          .from('ventas')
          .select(`
            id,
            numero,
            cliente_nombre,
            total,
            estado,
            tipo_venta,
            created_at
          `)
          .in(
            'estado',
            [
              'pagada',
              'completada',
              'con_saldo',
            ],
          )
          .order(
            'created_at',
            {
              ascending: false,
            },
          ),
      )
    }

    const resultados =
      await Promise.all(
        consultas,
      )

    const devolucionesRespuesta =
      resultados[0]

    if (
      devolucionesRespuesta.error
    ) {
      setError(
        devolucionesRespuesta.error.message,
      )
      setDevoluciones([])
      setCargando(false)
      return
    }

    setDevoluciones(
      (
        devolucionesRespuesta.data ??
        []
      ).map(
        (item: any) => ({
          id:
            Number(item.id),
          numero:
            String(item.numero),
          venta_id:
            Number(item.venta_id),
          motivo:
            String(item.motivo),
          total:
            Number(
              item.total ?? 0,
            ),
          estado:
            String(item.estado),
          estado_financiero:
            String(
              item.estado_financiero ??
              'pendiente',
            ),
          created_at:
            String(
              item.created_at,
            ),
          confirmada_at:
            item.confirmada_at,
          observaciones:
            item.observaciones,
          ventas:
            item.ventas,
        }),
      ),
    )

    if (
      puedeRegistrar &&
      resultados[1]
    ) {
      const ventasRespuesta =
        resultados[1]

      if (ventasRespuesta.error) {
        setError(
          ventasRespuesta.error.message,
        )
        setVentas([])
        setCargando(false)
        return
      }

      setVentas(
        (
          ventasRespuesta.data ??
          []
        ).map(
          (item: any) => ({
            id:
              Number(item.id),
            numero:
              String(item.numero),
            cliente_nombre:
              item.cliente_nombre,
            total:
              Number(
                item.total ?? 0,
              ),
            estado:
              String(item.estado),
            tipo_venta:
              String(
                item.tipo_venta,
              ),
            created_at:
              String(
                item.created_at,
              ),
          }),
        ),
      )
    }

    setCargando(false)
  }


  useEffect(() => {
    void cargarDatos()
  }, [roleCode])


  async function cargarDetalleVenta(
    ventaId: number,
  ) {
    setError('')
    setItemsRegistro([])

    if (!ventaId) {
      return
    }

    const {
      data,
      error: detalleError,
    } =
      await supabase
        .from('detalle_ventas')
        .select(`
          producto_id,
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
          ventaId,
        )

    if (detalleError) {
      setError(
        detalleError.message,
      )
      return
    }

    const detalle =
      (
        data ?? []
      ) as unknown as DetalleVenta[]

    setItemsRegistro(
      detalle.map(item => {
        const producto =
          relacion(
            item.productos,
          )

        return {
          producto_id:
            Number(
              item.producto_id,
            ),
          codigo:
            producto?.codigo ??
            '',
          nombre:
            producto?.nombre ??
            'Producto',
          cantidad_vendida:
            Number(
              item.cantidad,
            ),
          cantidad_devuelta: 0,
          precio_unitario:
            Number(
              item.precio_unitario,
            ),
        }
      }),
    )
  }


  function actualizarCantidadRegistro(
    productoId: number,
    cantidad: number,
  ) {
    setItemsRegistro(
      actual =>
        actual.map(item =>
          item.producto_id ===
          productoId
            ? {
                ...item,
                cantidad_devuelta:
                  Math.max(
                    0,
                    Math.min(
                      item.cantidad_vendida,
                      cantidad,
                    ),
                  ),
              }
            : item,
        ),
    )
  }


  async function registrarDevolucion() {
    if (!puedeRegistrar) {
      return
    }

    setError('')
    setExito('')

    const ventaId =
      Number(
        ventaSeleccionada,
      )

    const items =
      itemsRegistro
        .filter(
          item =>
            item.cantidad_devuelta >
            0,
        )
        .map(item => ({
          producto_id:
            item.producto_id,
          cantidad:
            item.cantidad_devuelta,
        }))

    if (!ventaId) {
      setError(
        'Selecciona una venta.',
      )
      return
    }

    if (
      motivo.trim().length < 3
    ) {
      setError(
        'Indica un motivo válido.',
      )
      return
    }

    if (items.length === 0) {
      setError(
        'Indica al menos un producto y cantidad a devolver.',
      )
      return
    }

    setProcesando(true)

    const {
      data,
      error: rpcError,
    } =
      await supabase.rpc(
        'registrar_devolucion_venta',
        {
          p_venta_id:
            ventaId,
          p_items:
            items,
          p_motivo:
            motivo.trim(),
          p_observaciones:
            observaciones.trim() ||
            null,
        },
      )

    if (rpcError) {
      setError(
        rpcError.message,
      )
      setProcesando(false)
      return
    }

    const resultado =
      Array.isArray(data)
        ? data[0]
        : data

    setExito(
      resultado?.numero
        ? `Devolución ${resultado.numero} registrada correctamente.`
        : 'Devolución registrada correctamente.',
    )

    setVentaSeleccionada('')
    setItemsRegistro([])
    setMotivo('')
    setObservaciones('')

    await cargarDatos()
    setProcesando(false)
  }


  async function abrirRevision(
    devolucion: Devolucion,
  ) {
    setDevolucionSeleccionada(
      devolucion,
    )
    setItemsConfirmacion([])
    setError('')
    setExito('')

    const {
      data,
      error: detalleError,
    } =
      await supabase
        .from(
          'detalle_devoluciones_venta',
        )
        .select(`
          id,
          producto_id,
          cantidad,
          precio_unitario,
          subtotal,
          destino,
          observaciones,
          productos (
            codigo,
            nombre
          )
        `)
        .eq(
          'devolucion_id',
          devolucion.id,
        )

    if (detalleError) {
      setError(
        detalleError.message,
      )
      return
    }

    const detalle =
      (
        data ?? []
      ) as unknown as DetalleDevolucion[]

    setItemsConfirmacion(
      detalle.map(item => {
        const producto =
          relacion(
            item.productos,
          )

        return {
          producto_id:
            Number(
              item.producto_id,
            ),
          codigo:
            producto?.codigo ??
            '',
          nombre:
            producto?.nombre ??
            'Producto',
          cantidad:
            Number(
              item.cantidad,
            ),
          destino:
            item.destino ===
            'merma'
              ? 'merma'
              : 'inventario',
        }
      }),
    )
  }


  function actualizarDestino(
    productoId: number,
    destino:
      | 'inventario'
      | 'merma',
  ) {
    setItemsConfirmacion(
      actual =>
        actual.map(item =>
          item.producto_id ===
          productoId
            ? {
                ...item,
                destino,
              }
            : item,
        ),
    )
  }


  async function confirmarDevolucion() {
    if (
      !puedeResolver ||
      !devolucionSeleccionada
    ) {
      return
    }

    setProcesando(true)
    setError('')
    setExito('')

    const {
      error: rpcError,
    } =
      await supabase.rpc(
        'confirmar_devolucion_venta',
        {
          p_devolucion_id:
            devolucionSeleccionada.id,
          p_items:
            itemsConfirmacion.map(
              item => ({
                producto_id:
                  item.producto_id,
                destino:
                  item.destino,
              }),
            ),
        },
      )

    if (rpcError) {
      setError(
        rpcError.message,
      )
      setProcesando(false)
      return
    }

    setExito(
      `Devolución ${devolucionSeleccionada.numero} confirmada correctamente.`,
    )

    setDevolucionSeleccionada(
      null,
    )
    setItemsConfirmacion([])

    await cargarDatos()
    setProcesando(false)
  }


  async function anularDevolucion(
    devolucion: Devolucion,
  ) {
    if (!puedeResolver) {
      return
    }

    const motivoAnulacion =
      window.prompt(
        `Motivo para anular ${devolucion.numero}:`,
      )

    if (
      !motivoAnulacion ||
      motivoAnulacion
        .trim().length < 3
    ) {
      return
    }

    setProcesando(true)
    setError('')
    setExito('')

    const {
      error: rpcError,
    } =
      await supabase.rpc(
        'anular_devolucion_venta',
        {
          p_devolucion_id:
            devolucion.id,
          p_motivo:
            motivoAnulacion.trim(),
        },
      )

    if (rpcError) {
      setError(
        rpcError.message,
      )
      setProcesando(false)
      return
    }

    setExito(
      `Devolución ${devolucion.numero} anulada correctamente.`,
    )

    setDevolucionSeleccionada(
      null,
    )
    setItemsConfirmacion([])

    await cargarDatos()
    setProcesando(false)
  }


  if (!puedeConsultar) {
    return (
      <div className="inventory-error">
        Este perfil no tiene acceso a devoluciones de venta.
      </div>
    )
  }


  if (cargando) {
    return (
      <div className="inventory-loading">
        <div className="inventory-spinner" />
        <span>
          Cargando devoluciones...
        </span>
      </div>
    )
  }


  return (
    <div className="returns-module">

      <section className="returns-toolbar">
        <div>
          <span className="panel-label">
            DEVOLUCIONES
          </span>

          <h2>
            {puedeRegistrar
              ? 'Registrar devolución de venta'
              : puedeResolver
                ? 'Revisión de devoluciones'
                : 'Consulta de devoluciones'}
          </h2>

          <p>
            {puedeRegistrar
              ? 'Registra los productos devueltos por el cliente para revisión comercial.'
              : puedeResolver
                ? 'Confirma el destino de los productos devueltos o anula solicitudes registradas.'
                : 'Consulta las devoluciones registradas y su estado.'}
          </p>
        </div>

        <button
          type="button"
          className="inventory-refresh-button"
          onClick={() =>
            void cargarDatos()
          }
        >
          ↻ Actualizar
        </button>
      </section>


      <div className="returns-summary-grid">
        <article className="returns-summary-card">
          <span>TOTAL</span>
          <strong>
            {resumen.total}
          </strong>
          <p>devoluciones registradas</p>
        </article>

        <article className="returns-summary-card">
          <span>REGISTRADAS</span>
          <strong>
            {resumen.registradas}
          </strong>
          <p>pendientes de revisión</p>
        </article>

        <article className="returns-summary-card">
          <span>CONFIRMADAS</span>
          <strong>
            {resumen.confirmadas}
          </strong>
          <p>procesadas comercialmente</p>
        </article>

        <article className="returns-summary-card">
          <span>ANULADAS</span>
          <strong>
            {resumen.anuladas}
          </strong>
          <p>solicitudes anuladas</p>
        </article>
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


      {puedeRegistrar && (
        <section className="returns-form-card">
          <div className="returns-section-head">
            <div>
              <span className="panel-label">
                NUEVA DEVOLUCIÓN
              </span>

              <h3>
                Seleccionar venta
              </h3>
            </div>
          </div>

          <div className="returns-form-grid">
            <label className="returns-field">
              Venta
              <select
                value={
                  ventaSeleccionada
                }
                onChange={event => {
                  const value =
                    event.target.value

                  setVentaSeleccionada(
                    value,
                  )

                  void cargarDetalleVenta(
                    Number(value),
                  )
                }}
              >
                <option value="">
                  Seleccionar venta
                </option>

                {ventas.map(
                  venta => (
                    <option
                      key={venta.id}
                      value={venta.id}
                    >
                      {venta.numero} - {venta.cliente_nombre ?? 'Cliente general'} - {formatearCordobas(venta.total)}
                    </option>
                  ),
                )}
              </select>
            </label>

            <label className="returns-field">
              Motivo
              <input
                type="text"
                value={motivo}
                onChange={event =>
                  setMotivo(
                    event.target.value,
                  )
                }
                placeholder="Ej. producto defectuoso"
              />
            </label>

            <label className="returns-field returns-field--full">
              Observaciones
              <textarea
                value={observaciones}
                onChange={event =>
                  setObservaciones(
                    event.target.value,
                  )
                }
                placeholder="Opcional"
              />
            </label>
          </div>


          {itemsRegistro.length >
            0 && (
            <div className="returns-items-wrap">
              <table className="returns-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Vendido</th>
                    <th>Precio</th>
                    <th>A devolver</th>
                  </tr>
                </thead>

                <tbody>
                  {itemsRegistro.map(
                    item => (
                      <tr
                        key={
                          item.producto_id
                        }
                      >
                        <td>
                          <strong>
                            {item.nombre}
                          </strong>
                          <small>
                            {item.codigo}
                          </small>
                        </td>

                        <td>
                          {item.cantidad_vendida}
                        </td>

                        <td>
                          {formatearCordobas(
                            item.precio_unitario,
                          )}
                        </td>

                        <td>
                          <input
                            type="number"
                            min="0"
                            max={
                              item.cantidad_vendida
                            }
                            step="1"
                            value={
                              item.cantidad_devuelta
                            }
                            onChange={event =>
                              actualizarCantidadRegistro(
                                item.producto_id,
                                Number(
                                  event.target.value,
                                ),
                              )
                            }
                          />
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}


          <div className="returns-actions">
            <button
              type="button"
              className="product-primary-button"
              disabled={
                procesando
              }
              onClick={() =>
                void registrarDevolucion()
              }
            >
              {procesando
                ? 'Registrando...'
                : 'Registrar devolución'}
            </button>
          </div>
        </section>
      )}


      {puedeResolver &&
        devolucionSeleccionada && (
        <section className="returns-review-card">
          <div className="returns-section-head">
            <div>
              <span className="panel-label">
                REVISIÓN
              </span>

              <h3>
                {devolucionSeleccionada.numero}
              </h3>

              <p>
                Define si cada producto regresa a inventario o se registra como merma.
              </p>
            </div>

            <button
              type="button"
              className="product-close-button"
              onClick={() => {
                setDevolucionSeleccionada(
                  null,
                )
                setItemsConfirmacion([])
              }}
            >
              ×
            </button>
          </div>

          <div className="returns-items-wrap">
            <table className="returns-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Cantidad</th>
                  <th>Destino</th>
                </tr>
              </thead>

              <tbody>
                {itemsConfirmacion.map(
                  item => (
                    <tr
                      key={
                        item.producto_id
                      }
                    >
                      <td>
                        <strong>
                          {item.nombre}
                        </strong>
                        <small>
                          {item.codigo}
                        </small>
                      </td>

                      <td>
                        {item.cantidad}
                      </td>

                      <td>
                        <select
                          value={
                            item.destino
                          }
                          onChange={event =>
                            actualizarDestino(
                              item.producto_id,
                              event.target
                                .value as
                                | 'inventario'
                                | 'merma',
                            )
                          }
                        >
                          <option value="inventario">
                            Inventario
                          </option>

                          <option value="merma">
                            Merma
                          </option>
                        </select>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>

          <div className="returns-actions returns-actions--spread">
            <button
              type="button"
              className="returns-cancel-button"
              disabled={
                procesando
              }
              onClick={() =>
                void anularDevolucion(
                  devolucionSeleccionada,
                )
              }
            >
              Anular devolución
            </button>

            <button
              type="button"
              className="product-primary-button"
              disabled={
                procesando ||
                itemsConfirmacion.length ===
                  0
              }
              onClick={() =>
                void confirmarDevolucion()
              }
            >
              {procesando
                ? 'Procesando...'
                : 'Confirmar devolución'}
            </button>
          </div>
        </section>
      )}


      <section className="returns-list-card">
        <div className="returns-section-head">
          <div>
            <span className="panel-label">
              REGISTRO
            </span>

            <h3>
              Devoluciones de venta
            </h3>
          </div>

          <span className="sales-result-count">
            {devolucionesFiltradas.length}{' '}
            resultado
            {devolucionesFiltradas.length ===
            1
              ? ''
              : 's'}
          </span>
        </div>

        <div className="clients-search">
          <span>⌕</span>

          <input
            type="text"
            value={busqueda}
            onChange={event =>
              setBusqueda(
                event.target.value,
              )
            }
            placeholder="Buscar por devolución, venta, cliente, motivo o estado..."
          />
        </div>

        <div className="returns-table-wrap">
          <table className="returns-table">
            <thead>
              <tr>
                <th>Devolución</th>
                <th>Venta</th>
                <th>Cliente</th>
                <th>Motivo</th>
                <th>Total</th>
                <th>Estado</th>
                <th>Fecha</th>
                <th>Acciones</th>
              </tr>
            </thead>

            <tbody>
              {devolucionesFiltradas.length ===
              0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="inventory-empty"
                  >
                    No se encontraron devoluciones.
                  </td>
                </tr>
              ) : (
                devolucionesFiltradas.map(
                  devolucion => {
                    const venta =
                      relacion(
                        devolucion.ventas,
                      )

                    return (
                      <tr
                        key={
                          devolucion.id
                        }
                      >
                        <td>
                          <strong>
                            {devolucion.numero}
                          </strong>
                        </td>

                        <td>
                          {venta?.numero ??
                            '—'}
                        </td>

                        <td>
                          {venta?.cliente_nombre ??
                            'Cliente general'}
                        </td>

                        <td>
                          {devolucion.motivo}
                        </td>

                        <td>
                          <strong>
                            {formatearCordobas(
                              devolucion.total,
                            )}
                          </strong>
                        </td>

                        <td>
                          <span
                            className={
                              claseEstado(
                                devolucion.estado,
                              )
                            }
                          >
                            {etiquetaEstado(
                              devolucion.estado,
                            )}
                          </span>
                        </td>

                        <td>
                          {formatearFecha(
                            devolucion.created_at,
                          )}
                        </td>

                        <td>
                          {puedeResolver &&
                          devolucion.estado ===
                            'registrada' ? (
                            <div className="returns-row-actions">
                              <button
                                type="button"
                                className="product-edit-button"
                                onClick={() =>
                                  void abrirRevision(
                                    devolucion,
                                  )
                                }
                              >
                                Revisar
                              </button>

                              <button
                                type="button"
                                className="returns-cancel-small"
                                disabled={
                                  procesando
                                }
                                onClick={() =>
                                  void anularDevolucion(
                                    devolucion,
                                  )
                                }
                              >
                                Anular
                              </button>
                            </div>
                          ) : (
                            <span className="quotes-readonly">
                              Consulta
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  },
                )
              )}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  )
}
