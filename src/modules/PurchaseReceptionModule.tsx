import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import { supabase } from '../lib/supabase'


type PurchaseReceptionModuleProps = {
  roleCode: string
}


type ProveedorRelacion = {
  codigo: string
  nombre: string
}


type RecepcionRelacion = {
  id: number
  numero: string
  fecha_recepcion: string
}


type CompraRespuesta = {
  id: number
  numero: string
  fecha_compra: string

  tipo_compra:
    | 'directa'
    | 'cotizacion'
    | 'licitacion'

  total: number | string

  estado:
    | 'registrada'
    | 'autorizada'
    | 'recibida'
    | 'anulada'

  proveedores:
    | ProveedorRelacion
    | ProveedorRelacion[]
    | null

  recepciones_compra:
    | RecepcionRelacion
    | RecepcionRelacion[]
    | null
}


type CompraPendiente = {
  id: number
  numero: string
  fechaCompra: string

  tipoCompra:
    | 'directa'
    | 'cotizacion'
    | 'licitacion'

  total: number
  proveedorCodigo: string
  proveedorNombre: string
}


type ProductoRelacion = {
  codigo: string
  nombre: string
  unidad_medida: string
}


type DetalleRespuesta = {
  id: number
  producto_id: number
  cantidad: number | string
  costo_unitario: number | string
  subtotal: number | string

  productos:
    | ProductoRelacion
    | ProductoRelacion[]
    | null
}


type ItemRecepcion = {
  detalleId: number
  productoId: number
  codigo: string
  nombre: string
  unidad: string
  cantidadComprada: number
  cantidadRecibida: string
}


// ==========================================================
// UTILIDADES
// ==========================================================

function fechaLocalActual() {
  const fecha =
    new Date()

  const year =
    fecha.getFullYear()

  const month =
    String(
      fecha.getMonth() + 1,
    ).padStart(
      2,
      '0',
    )

  const day =
    String(
      fecha.getDate(),
    ).padStart(
      2,
      '0',
    )

  return `${year}-${month}-${day}`
}


function obtenerProveedor(
  relacion:
    | ProveedorRelacion
    | ProveedorRelacion[]
    | null,
) {
  if (!relacion) {
    return null
  }

  if (
    Array.isArray(
      relacion,
    )
  ) {
    return (
      relacion[0] ??
      null
    )
  }

  return relacion
}


function obtenerProducto(
  relacion:
    | ProductoRelacion
    | ProductoRelacion[]
    | null,
) {
  if (!relacion) {
    return null
  }

  if (
    Array.isArray(
      relacion,
    )
  ) {
    return (
      relacion[0] ??
      null
    )
  }

  return relacion
}


function tieneRecepcion(
  relacion:
    | RecepcionRelacion
    | RecepcionRelacion[]
    | null,
) {
  if (!relacion) {
    return false
  }

  if (
    Array.isArray(
      relacion,
    )
  ) {
    return relacion.length > 0
  }

  return true
}


function moneda(
  valor: number | string,
) {
  return new Intl.NumberFormat(
    'es-NI',
    {
      style: 'currency',
      currency: 'NIO',
      minimumFractionDigits: 2,
    },
  ).format(
    Number(valor) || 0,
  )
}


function nombreTipoCompra(
  tipo:
    CompraPendiente['tipoCompra'],
) {
  if (
    tipo ===
    'cotizacion'
  ) {
    return 'Cotización'
  }

  if (
    tipo ===
    'licitacion'
  ) {
    return 'Licitación'
  }

  return 'Compra directa'
}


function obtenerMensajeError(
  err: unknown,
  respaldo: string,
) {
  if (
    typeof err ===
      'object' &&
    err !== null &&
    'message' in err
  ) {
    const mensaje =
      (
        err as {
          message?: unknown
        }
      ).message

    if (
      typeof mensaje ===
      'string'
    ) {
      return mensaje
    }
  }

  if (
    err instanceof Error
  ) {
    return err.message
  }

  return respaldo
}


// ==========================================================
// COMPONENTE
// ==========================================================

export default function PurchaseReceptionModule({
  roleCode,
}: PurchaseReceptionModuleProps) {
  /*
   * Solamente Almacén / Bodeguero puede
   * ejecutar la recepción física.
   */
  const puedeGestionarRecepcion =
    roleCode === 'almacen'


  const [
    comprasPendientes,
    setComprasPendientes,
  ] =
    useState<
      CompraPendiente[]
    >([])


  const [
    compraSeleccionada,
    setCompraSeleccionada,
  ] =
    useState<
      CompraPendiente | null
    >(null)


  const [
    items,
    setItems,
  ] =
    useState<
      ItemRecepcion[]
    >([])


  const [
    fechaRecepcion,
    setFechaRecepcion,
  ] =
    useState(
      fechaLocalActual(),
    )


  const [
    observaciones,
    setObservaciones,
  ] =
    useState('')


  const [
    busqueda,
    setBusqueda,
  ] =
    useState('')


  const [
    cargando,
    setCargando,
  ] =
    useState(true)


  const [
    cargandoDetalle,
    setCargandoDetalle,
  ] =
    useState(false)


  const [
    guardando,
    setGuardando,
  ] =
    useState(false)


  const [
    error,
    setError,
  ] =
    useState('')


  const [
    mensaje,
    setMensaje,
  ] =
    useState('')


  // ==========================================================
  // CARGAR RECEPCIONES PENDIENTES
  // ==========================================================

  async function cargarPendientes() {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          'compras',
        )
        .select(`
          id,
          numero,
          fecha_compra,
          tipo_compra,
          total,
          estado,
          proveedores (
            codigo,
            nombre
          ),
          recepciones_compra (
            id,
            numero,
            fecha_recepcion
          )
        `)
        .eq(
          'estado',
          'autorizada',
        )
        .order(
          'created_at',
          {
            ascending:
              false,
          },
        )


    if (error) {
      throw error
    }


    const respuesta =
      (
        data ??
        []
      ) as unknown as CompraRespuesta[]


    const pendientes =
      respuesta
        .filter(
          compra =>
            !tieneRecepcion(
              compra
                .recepciones_compra,
            ),
        )
        .map(
          (
            compra,
          ): CompraPendiente => {
            const proveedor =
              obtenerProveedor(
                compra.proveedores,
              )

            return {
              id:
                compra.id,

              numero:
                compra.numero,

              fechaCompra:
                compra.fecha_compra,

              tipoCompra:
                compra.tipo_compra,

              total:
                Number(
                  compra.total,
                ) || 0,

              proveedorCodigo:
                proveedor
                  ?.codigo ??
                '—',

              proveedorNombre:
                proveedor
                  ?.nombre ??
                'Proveedor',
            }
          },
        )


    setComprasPendientes(
      pendientes,
    )
  }


  async function cargarTodo() {
    try {
      setCargando(
        true,
      )

      setError('')

      await cargarPendientes()
    } catch (err) {
      setError(
        obtenerMensajeError(
          err,
          'No fue posible cargar las recepciones pendientes.',
        ),
      )
    } finally {
      setCargando(
        false,
      )
    }
  }


  useEffect(() => {
    void cargarTodo()
  }, [])


  // ==========================================================
  // FILTRO
  // ==========================================================

  const pendientesFiltradas =
    useMemo(() => {
      const termino =
        busqueda
          .trim()
          .toLowerCase()

      if (!termino) {
        return comprasPendientes
      }

      return comprasPendientes.filter(
        compra => {
          const texto = [
            compra.numero,
            compra.fechaCompra,
            compra.proveedorCodigo,
            compra.proveedorNombre,
            nombreTipoCompra(
              compra.tipoCompra,
            ),
          ]
            .join(' ')
            .toLowerCase()

          return texto.includes(
            termino,
          )
        },
      )
    }, [
      comprasPendientes,
      busqueda,
    ])


  // ==========================================================
  // ABRIR RECEPCIÓN
  // SOLO ALMACÉN
  // ==========================================================

  async function abrirRecepcion(
    compra: CompraPendiente,
  ) {
    if (
      !puedeGestionarRecepcion
    ) {
      setError(
        'Este perfil tiene acceso de consulta y no puede registrar recepciones.',
      )

      return
    }


    try {
      setCargandoDetalle(
        true,
      )

      setError('')
      setMensaje('')


      const {
        data,
        error,
      } =
        await supabase
          .from(
            'detalle_compras',
          )
          .select(`
            id,
            producto_id,
            cantidad,
            costo_unitario,
            subtotal,
            productos (
              codigo,
              nombre,
              unidad_medida
            )
          `)
          .eq(
            'compra_id',
            compra.id,
          )
          .order(
            'id',
            {
              ascending:
                true,
            },
          )


      if (error) {
        throw error
      }


      const detalle =
        (
          data ??
          []
        ) as unknown as DetalleRespuesta[]


      if (
        detalle.length ===
        0
      ) {
        throw new Error(
          'La compra no contiene productos para recibir.',
        )
      }


      const itemsRecepcion =
        detalle.map(
          (
            item,
          ): ItemRecepcion => {
            const producto =
              obtenerProducto(
                item.productos,
              )

            const cantidad =
              Number(
                item.cantidad,
              ) || 0

            return {
              detalleId:
                item.id,

              productoId:
                item.producto_id,

              codigo:
                producto
                  ?.codigo ??
                '—',

              nombre:
                producto
                  ?.nombre ??
                'Producto',

              unidad:
                producto
                  ?.unidad_medida ??
                '—',

              cantidadComprada:
                cantidad,

              cantidadRecibida:
                String(
                  cantidad,
                ),
            }
          },
        )


      setCompraSeleccionada(
        compra,
      )

      setItems(
        itemsRecepcion,
      )

      setFechaRecepcion(
        fechaLocalActual(),
      )

      setObservaciones('')
    } catch (err) {
      setError(
        obtenerMensajeError(
          err,
          'No fue posible cargar el detalle de la compra.',
        ),
      )
    } finally {
      setCargandoDetalle(
        false,
      )
    }
  }


  // ==========================================================
  // CERRAR RECEPCIÓN
  // ==========================================================

  function cerrarRecepcion() {
    if (guardando) {
      return
    }

    setCompraSeleccionada(
      null,
    )

    setItems([])
    setObservaciones('')
    setError('')
  }


  // ==========================================================
  // ACTUALIZAR CANTIDAD
  // ==========================================================

  function actualizarCantidad(
    productoId: number,
    valor: string,
  ) {
    if (
      !puedeGestionarRecepcion
    ) {
      return
    }

    setItems(
      actuales =>
        actuales.map(
          item =>
            item.productoId ===
            productoId
              ? {
                  ...item,
                  cantidadRecibida:
                    valor,
                }
              : item,
        ),
    )
  }


  // ==========================================================
  // REGISTRAR RECEPCIÓN
  // SOLO ALMACÉN
  // ==========================================================

  async function registrarRecepcion() {
    if (
      !puedeGestionarRecepcion
    ) {
      setError(
        'Este perfil no tiene permisos para registrar recepciones.',
      )

      return
    }


    if (
      !compraSeleccionada
    ) {
      return
    }


    try {
      setGuardando(
        true,
      )

      setError('')
      setMensaje('')


      if (
        !fechaRecepcion
      ) {
        throw new Error(
          'Seleccione la fecha de recepción.',
        )
      }


      if (
        items.length ===
        0
      ) {
        throw new Error(
          'No hay productos para recibir.',
        )
      }


      for (
        const item of
        items
      ) {
        const cantidadRecibida =
          Number(
            item.cantidadRecibida,
          )


        if (
          !Number.isFinite(
            cantidadRecibida,
          ) ||
          cantidadRecibida <=
            0
        ) {
          throw new Error(
            `La cantidad recibida de ${item.nombre} debe ser mayor que cero.`,
          )
        }


        if (
          item.unidad
            .trim()
            .toLowerCase() ===
            'unidad' &&
          !Number.isInteger(
            cantidadRecibida,
          )
        ) {
          throw new Error(
            `La cantidad recibida de ${item.nombre} debe ser un número entero.`,
          )
        }


        if (
          cantidadRecibida !==
          item.cantidadComprada
        ) {
          throw new Error(
            `La recepción actual es completa. ${item.nombre}: comprada ${item.cantidadComprada}, recibida ${cantidadRecibida}.`,
          )
        }
      }


      const itemsRpc =
        items.map(
          item => ({
            producto_id:
              item.productoId,

            cantidad_recibida:
              Number(
                item.cantidadRecibida,
              ),
          }),
        )


      const {
        data,
        error,
      } =
        await supabase.rpc(
          'registrar_recepcion_compra',
          {
            p_compra_id:
              compraSeleccionada.id,

            p_items:
              itemsRpc,

            p_fecha_recepcion:
              fechaRecepcion,

            p_observaciones:
              observaciones
                .trim() ||
              null,
          },
        )


      if (error) {
        throw error
      }


      const resultado =
        Array.isArray(
          data,
        )
          ? data[0]
          : data


      const numero =
        resultado
          ?.numero ??
        'registrada'


      const compraNumero =
        compraSeleccionada
          .numero


      setCompraSeleccionada(
        null,
      )

      setItems([])
      setObservaciones('')


      await cargarPendientes()


      setMensaje(
        `Recepción ${numero} registrada correctamente para la compra ${compraNumero}.`,
      )
    } catch (err) {
      setError(
        obtenerMensajeError(
          err,
          'No fue posible registrar la recepción.',
        ),
      )
    } finally {
      setGuardando(
        false,
      )
    }
  }


  // ==========================================================
  // CARGANDO
  // ==========================================================

  if (cargando) {
    return (
      <div className="inventory-module">
        <div className="inventory-toolbar">
          Cargando recepciones...
        </div>
      </div>
    )
  }


  // ==========================================================
  // INTERFAZ
  // ==========================================================

  return (
    <div className="inventory-module">

      {/* ====================================================
          ENCABEZADO
      ==================================================== */}

      <div className="inventory-toolbar">
        <div>
          <span className="panel-label">
            BODEGA · RECEPCIÓN
          </span>

          <h2>
            Recepción de productos
          </h2>

          <p>
            {puedeGestionarRecepcion
              ? 'Verifica las compras pendientes y confirma la entrada física de los productos al inventario.'
              : 'Consulta las compras autorizadas pendientes de recepción.'}
          </p>
        </div>


        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            void cargarTodo()
          }
        >
          ↻ Actualizar
        </button>
      </div>


      {/* ====================================================
          ESTADÍSTICAS
      ==================================================== */}

      <div className="inventory-stats">
        <div className="inventory-stat-card">
          <span>
            RECEPCIONES PENDIENTES
          </span>

          <strong>
            {
              comprasPendientes.length
            }
          </strong>

          <small>
            {puedeGestionarRecepcion
              ? 'compras por recibir'
              : 'compras autorizadas'}
          </small>
        </div>


        {puedeGestionarRecepcion && (
          <>
            <div className="inventory-stat-card">
              <span>
                COMPRA SELECCIONADA
              </span>

              <strong
                style={{
                  fontSize:
                    '20px',
                }}
              >
                {compraSeleccionada
                  ? compraSeleccionada.numero
                  : '—'}
              </strong>

              <small>
                para verificación
              </small>
            </div>


            <div className="inventory-stat-card">
              <span>
                PRODUCTOS A RECIBIR
              </span>

              <strong>
                {
                  items.length
                }
              </strong>

              <small>
                líneas de producto
              </small>
            </div>
          </>
        )}
      </div>


      {/* ====================================================
          MENSAJES
      ==================================================== */}

      {mensaje && (
        <div className="success-message">
          {mensaje}
        </div>
      )}


      {error && (
        <div className="error-message">
          {error}
        </div>
      )}


      {/* ====================================================
          FORMULARIO DE RECEPCIÓN
          SOLO ALMACÉN
      ==================================================== */}

      {puedeGestionarRecepcion &&
        compraSeleccionada && (
          <div className="inventory-toolbar">
            <div
              style={{
                width:
                  '100%',
              }}
            >
              <div
                style={{
                  display:
                    'flex',
                  justifyContent:
                    'space-between',
                  alignItems:
                    'flex-start',
                  gap:
                    '20px',
                  marginBottom:
                    '22px',
                }}
              >
                <div>
                  <span className="panel-label">
                    REGISTRAR RECEPCIÓN
                  </span>

                  <h2>
                    {
                      compraSeleccionada.numero
                    }
                  </h2>

                  <p>
                    {
                      compraSeleccionada.proveedorNombre
                    }

                    {' · '}

                    {nombreTipoCompra(
                      compraSeleccionada.tipoCompra,
                    )}
                  </p>
                </div>


                <button
                  type="button"
                  className="secondary-button"
                  onClick={
                    cerrarRecepcion
                  }
                  disabled={
                    guardando
                  }
                >
                  ✕ Cerrar
                </button>
              </div>


              <div
                style={{
                  display:
                    'grid',
                  gridTemplateColumns:
                    '1fr 2fr',
                  gap:
                    '16px',
                  marginBottom:
                    '18px',
                }}
              >
                <label>
                  Fecha de recepción *

                  <input
                    type="date"
                    value={
                      fechaRecepcion
                    }
                    onChange={
                      event =>
                        setFechaRecepcion(
                          event
                            .target
                            .value,
                        )
                    }
                  />
                </label>


                <label>
                  Observaciones

                  <input
                    type="text"
                    value={
                      observaciones
                    }
                    onChange={
                      event =>
                        setObservaciones(
                          event
                            .target
                            .value,
                        )
                    }
                    placeholder="Ej. Mercadería recibida en buen estado"
                  />
                </label>
              </div>


              <div className="inventory-table-wrapper">
                <table className="inventory-table">
                  <thead>
                    <tr>
                      <th>
                        CÓDIGO
                      </th>

                      <th>
                        PRODUCTO
                      </th>

                      <th>
                        UNIDAD
                      </th>

                      <th>
                        CANTIDAD COMPRADA
                      </th>

                      <th>
                        CANTIDAD RECIBIDA
                      </th>

                      <th>
                        VERIFICACIÓN
                      </th>
                    </tr>
                  </thead>


                  <tbody>
                    {cargandoDetalle && (
                      <tr>
                        <td
                          colSpan={
                            6
                          }
                          style={{
                            textAlign:
                              'center',
                            padding:
                              '30px',
                          }}
                        >
                          Cargando detalle...
                        </td>
                      </tr>
                    )}


                    {!cargandoDetalle &&
                      items.map(
                        item => {
                          const recibida =
                            Number(
                              item.cantidadRecibida,
                            )

                          const coincide =
                            Number.isFinite(
                              recibida,
                            ) &&
                            recibida ===
                              item.cantidadComprada


                          return (
                            <tr
                              key={
                                item.detalleId
                              }
                            >
                              <td>
                                {
                                  item.codigo
                                }
                              </td>


                              <td>
                                <strong>
                                  {
                                    item.nombre
                                  }
                                </strong>
                              </td>


                              <td>
                                {
                                  item.unidad
                                }
                              </td>


                              <td>
                                {
                                  item.cantidadComprada
                                }
                              </td>


                              <td>
                                <input
                                  type="number"
                                  min={
                                    item.unidad
                                      .trim()
                                      .toLowerCase() ===
                                    'unidad'
                                      ? '1'
                                      : '0.01'
                                  }
                                  step={
                                    item.unidad
                                      .trim()
                                      .toLowerCase() ===
                                    'unidad'
                                      ? '1'
                                      : '0.01'
                                  }
                                  value={
                                    item.cantidadRecibida
                                  }
                                  onChange={
                                    event =>
                                      actualizarCantidad(
                                        item.productoId,
                                        event
                                          .target
                                          .value,
                                      )
                                  }
                                  style={{
                                    width:
                                      '110px',
                                  }}
                                />
                              </td>


                              <td>
                                <span
                                  className={
                                    coincide
                                      ? 'status-badge status-success'
                                      : 'status-badge status-danger'
                                  }
                                >
                                  {coincide
                                    ? 'Coincide'
                                    : 'No coincide'}
                                </span>
                              </td>
                            </tr>
                          )
                        },
                      )}
                  </tbody>
                </table>
              </div>


              <div
                style={{
                  display:
                    'flex',
                  justifyContent:
                    'flex-end',
                  gap:
                    '10px',
                  marginTop:
                    '20px',
                }}
              >
                <button
                  type="button"
                  className="secondary-button"
                  onClick={
                    cerrarRecepcion
                  }
                  disabled={
                    guardando
                  }
                >
                  Cancelar
                </button>


                <button
                  type="button"
                  className="primary-button"
                  onClick={() =>
                    void registrarRecepcion()
                  }
                  disabled={
                    guardando ||
                    cargandoDetalle
                  }
                >
                  {guardando
                    ? 'Registrando...'
                    : 'Confirmar recepción'}
                </button>
              </div>
            </div>
          </div>
        )}


      {/* ====================================================
          BUSCADOR
      ==================================================== */}

      <div
        style={{
          display:
            'flex',
          alignItems:
            'center',
          justifyContent:
            'space-between',
          gap:
            '20px',
        }}
      >
        <input
          type="search"
          className="inventory-search"
          placeholder="⌕  Buscar compra, proveedor, tipo..."
          value={
            busqueda
          }
          onChange={
            event =>
              setBusqueda(
                event
                  .target
                  .value,
              )
          }
        />


        <span
          style={{
            fontSize:
              '13px',
            color:
              '#7b8494',
          }}
        >
          {
            pendientesFiltradas.length
          }{' '}

          {pendientesFiltradas.length ===
          1
            ? 'pendiente'
            : 'pendientes'}
        </span>
      </div>


      {/* ====================================================
          TABLA DE RECEPCIONES PENDIENTES
      ==================================================== */}

      <div className="inventory-table-wrapper">
        <table className="inventory-table">
          <thead>
            <tr>
              <th>
                COMPRA
              </th>

              <th>
                FECHA
              </th>

              <th>
                TIPO
              </th>

              <th>
                PROVEEDOR
              </th>

              <th>
                TOTAL
              </th>

              <th>
                ESTADO
              </th>

              {puedeGestionarRecepcion && (
                <th>
                  ACCIÓN
                </th>
              )}
            </tr>
          </thead>


          <tbody>
            {pendientesFiltradas.length ===
              0 && (
              <tr>
                <td
                  colSpan={
                    puedeGestionarRecepcion
                      ? 7
                      : 6
                  }
                  style={{
                    textAlign:
                      'center',
                    padding:
                      '40px',
                  }}
                >
                  No hay recepciones pendientes.
                </td>
              </tr>
            )}


            {pendientesFiltradas.map(
              compra => (
                <tr
                  key={
                    compra.id
                  }
                >
                  <td>
                    <strong>
                      {
                        compra.numero
                      }
                    </strong>
                  </td>


                  <td>
                    {
                      compra.fechaCompra
                    }
                  </td>


                  <td>
                    {nombreTipoCompra(
                      compra.tipoCompra,
                    )}
                  </td>


                  <td>
                    <strong>
                      {
                        compra.proveedorNombre
                      }
                    </strong>

                    <div
                      style={{
                        fontSize:
                          '12.5px',
                        color:
                          '#8a93a3',
                        marginTop:
                          '3px',
                      }}
                    >
                      {
                        compra.proveedorCodigo
                      }
                    </div>
                  </td>


                  <td>
                    <strong>
                      {moneda(
                        compra.total,
                      )}
                    </strong>
                  </td>


                  <td>
                    <span className="status-badge status-danger">
                      Pendiente
                    </span>
                  </td>


                  {puedeGestionarRecepcion && (
                    <td>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() =>
                          void abrirRecepcion(
                            compra,
                          )
                        }
                      >
                        Recibir
                      </button>
                    </td>
                  )}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}