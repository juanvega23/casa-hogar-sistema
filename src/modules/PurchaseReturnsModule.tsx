import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import { supabase } from '../lib/supabase'


type ProveedorRelacion = {
  codigo: string
  nombre: string
}

type CompraRespuesta = {
  id: number
  numero: string
  fecha_compra: string
  total: number | string
  proveedores:
    | ProveedorRelacion
    | ProveedorRelacion[]
    | null
}

type CompraRecibida = {
  id: number
  numero: string
  fechaCompra: string
  total: number
  proveedorCodigo: string
  proveedorNombre: string
}

type ProductoRelacion = {
  codigo: string
  nombre: string
  unidad_medida: string
}

type DetalleRecepcionRespuesta = {
  id: number
  producto_id: number
  cantidad_recibida: number | string
  productos:
    | ProductoRelacion
    | ProductoRelacion[]
    | null
}

type DetalleDevolucionAnterior = {
  producto_id: number
  cantidad_devuelta: number | string
}

type ItemDevolucion = {
  productoId: number
  codigo: string
  nombre: string
  unidad: string
  cantidadRecibida: number
  cantidadDevueltaAnterior: number
  cantidadDisponible: number
  cantidadDevolver: string
}

type CompraHistorialRelacion = {
  numero: string
  proveedores:
    | ProveedorRelacion
    | ProveedorRelacion[]
    | null
}

type DevolucionRespuesta = {
  id: number
  numero: string
  compra_id: number
  fecha_devolucion: string
  motivo: string
  observaciones: string | null
  created_at: string
  compras:
    | CompraHistorialRelacion
    | CompraHistorialRelacion[]
    | null
}

type DevolucionHistorial = {
  id: number
  numero: string
  compraId: number
  compraNumero: string
  fechaDevolucion: string
  motivo: string
  observaciones: string | null
  proveedorNombre: string
  proveedorCodigo: string
}

type DetalleDevolucionRespuesta = {
  id: number
  producto_id: number
  cantidad_devuelta: number | string
  productos:
    | ProductoRelacion
    | ProductoRelacion[]
    | null
}

type DetalleDevolucionVista = {
  id: number
  codigo: string
  nombre: string
  unidad: string
  cantidadDevuelta: number
}


function fechaLocalActual() {
  const fecha = new Date()

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


function obtenerCompraHistorial(
  relacion:
    | CompraHistorialRelacion
    | CompraHistorialRelacion[]
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


export default function PurchaseReturnsModule() {
  const [
    comprasRecibidas,
    setComprasRecibidas,
  ] =
    useState<
      CompraRecibida[]
    >([])

  const [
    devoluciones,
    setDevoluciones,
  ] =
    useState<
      DevolucionHistorial[]
    >([])

  const [
    compraSeleccionada,
    setCompraSeleccionada,
  ] =
    useState<
      CompraRecibida | null
    >(null)

  const [
    devolucionSeleccionada,
    setDevolucionSeleccionada,
  ] =
    useState<
      DevolucionHistorial | null
    >(null)

  const [
    items,
    setItems,
  ] =
    useState<
      ItemDevolucion[]
    >([])

  const [
    detalleDevolucion,
    setDetalleDevolucion,
  ] =
    useState<
      DetalleDevolucionVista[]
    >([])

  const [
    fechaDevolucion,
    setFechaDevolucion,
  ] =
    useState(
      fechaLocalActual(),
    )

  const [
    motivo,
    setMotivo,
  ] =
    useState('')

  const [
    observaciones,
    setObservaciones,
  ] =
    useState('')

  const [
    busquedaCompras,
    setBusquedaCompras,
  ] =
    useState('')

  const [
    busquedaHistorial,
    setBusquedaHistorial,
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
    cargandoHistorialDetalle,
    setCargandoHistorialDetalle,
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
  // CARGAR COMPRAS RECIBIDAS
  // ==========================================================

  async function cargarComprasRecibidas() {
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
          total,
          proveedores (
            codigo,
            nombre
          )
        `)
        .eq(
          'estado',
          'recibida',
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

    const compras =
      respuesta.map(
        (
          compra,
        ): CompraRecibida => {
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

    setComprasRecibidas(
      compras,
    )
  }


  // ==========================================================
  // CARGAR HISTORIAL DE DEVOLUCIONES
  // ==========================================================

  async function cargarHistorial() {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          'devoluciones_compra',
        )
        .select(`
          id,
          numero,
          compra_id,
          fecha_devolucion,
          motivo,
          observaciones,
          created_at,
          compras (
            numero,
            proveedores (
              codigo,
              nombre
            )
          )
        `)
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
      ) as unknown as DevolucionRespuesta[]

    const historial =
      respuesta.map(
        (
          devolucion,
        ): DevolucionHistorial => {
          const compra =
            obtenerCompraHistorial(
              devolucion.compras,
            )

          const proveedor =
            obtenerProveedor(
              compra
                ?.proveedores ??
                null,
            )

          return {
            id:
              devolucion.id,

            numero:
              devolucion.numero,

            compraId:
              devolucion.compra_id,

            compraNumero:
              compra?.numero ??
              '—',

            fechaDevolucion:
              devolucion.fecha_devolucion,

            motivo:
              devolucion.motivo,

            observaciones:
              devolucion.observaciones,

            proveedorNombre:
              proveedor
                ?.nombre ??
              'Proveedor',

            proveedorCodigo:
              proveedor
                ?.codigo ??
              '—',
          }
        },
      )

    setDevoluciones(
      historial,
    )
  }


  async function cargarTodo() {
    try {
      setCargando(
        true,
      )

      setError('')

      await Promise.all([
        cargarComprasRecibidas(),
        cargarHistorial(),
      ])
    } catch (err) {
      setError(
        obtenerMensajeError(
          err,
          'No fue posible cargar el módulo de devoluciones.',
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
  // FILTROS
  // ==========================================================

  const comprasFiltradas =
    useMemo(() => {
      const termino =
        busquedaCompras
          .trim()
          .toLowerCase()

      if (!termino) {
        return comprasRecibidas
      }

      return comprasRecibidas.filter(
        compra => {
          const texto = [
            compra.numero,
            compra.fechaCompra,
            compra.proveedorCodigo,
            compra.proveedorNombre,
          ]
            .join(' ')
            .toLowerCase()

          return texto.includes(
            termino,
          )
        },
      )
    }, [
      comprasRecibidas,
      busquedaCompras,
    ])


  const historialFiltrado =
    useMemo(() => {
      const termino =
        busquedaHistorial
          .trim()
          .toLowerCase()

      if (!termino) {
        return devoluciones
      }

      return devoluciones.filter(
        devolucion => {
          const texto = [
            devolucion.numero,
            devolucion.compraNumero,
            devolucion.fechaDevolucion,
            devolucion.motivo,
            devolucion.proveedorNombre,
            devolucion.proveedorCodigo,
          ]
            .join(' ')
            .toLowerCase()

          return texto.includes(
            termino,
          )
        },
      )
    }, [
      devoluciones,
      busquedaHistorial,
    ])


  // ==========================================================
  // ABRIR DEVOLUCIÓN
  // ==========================================================

  async function abrirDevolucion(
    compra: CompraRecibida,
  ) {
    try {
      setCargandoDetalle(
        true,
      )

      setError('')
      setMensaje('')

      setDevolucionSeleccionada(
        null,
      )

      setDetalleDevolucion(
        [],
      )


      // --------------------------------------------------------
      // RECEPCIÓN DE LA COMPRA
      // --------------------------------------------------------

      const {
        data:
          recepcionData,
        error:
          recepcionError,
      } =
        await supabase
          .from(
            'recepciones_compra',
          )
          .select(
            'id',
          )
          .eq(
            'compra_id',
            compra.id,
          )
          .single()


      if (
        recepcionError
      ) {
        throw recepcionError
      }


      if (
        !recepcionData
      ) {
        throw new Error(
          'La compra no tiene una recepción registrada.',
        )
      }


      // --------------------------------------------------------
      // DETALLE RECIBIDO
      // --------------------------------------------------------

      const {
        data:
          detalleRecepcionData,
        error:
          detalleRecepcionError,
      } =
        await supabase
          .from(
            'detalle_recepciones_compra',
          )
          .select(`
            id,
            producto_id,
            cantidad_recibida,
            productos (
              codigo,
              nombre,
              unidad_medida
            )
          `)
          .eq(
            'recepcion_id',
            recepcionData.id,
          )
          .order(
            'id',
            {
              ascending:
                true,
            },
          )


      if (
        detalleRecepcionError
      ) {
        throw detalleRecepcionError
      }


      const detalleRecepcion =
        (
          detalleRecepcionData ??
          []
        ) as unknown as DetalleRecepcionRespuesta[]


      if (
        detalleRecepcion.length ===
        0
      ) {
        throw new Error(
          'La recepción no contiene productos.',
        )
      }


      // --------------------------------------------------------
      // DEVOLUCIONES ANTERIORES DE ESA COMPRA
      // --------------------------------------------------------

      const {
        data:
          devolucionesAnteriores,
        error:
          devolucionesError,
      } =
        await supabase
          .from(
            'devoluciones_compra',
          )
          .select(
            'id',
          )
          .eq(
            'compra_id',
            compra.id,
          )


      if (
        devolucionesError
      ) {
        throw devolucionesError
      }


      const idsDevoluciones =
        (
          devolucionesAnteriores ??
          []
        ).map(
          item =>
            item.id,
        )


      let detallesDevueltos:
        DetalleDevolucionAnterior[] =
          []


      if (
        idsDevoluciones.length >
        0
      ) {
        const {
          data:
            detallesData,
          error:
            detallesError,
        } =
          await supabase
            .from(
              'detalle_devoluciones_compra',
            )
            .select(`
              producto_id,
              cantidad_devuelta
            `)
            .in(
              'devolucion_id',
              idsDevoluciones,
            )


        if (
          detallesError
        ) {
          throw detallesError
        }


        detallesDevueltos =
          (
            detallesData ??
            []
          ) as DetalleDevolucionAnterior[]
      }


      // --------------------------------------------------------
      // CONSTRUIR ITEMS DISPONIBLES
      // --------------------------------------------------------

      const itemsCalculados =
        detalleRecepcion.map(
          (
            detalle,
          ): ItemDevolucion => {
            const producto =
              obtenerProducto(
                detalle.productos,
              )

            const recibida =
              Number(
                detalle.cantidad_recibida,
              ) || 0


            const yaDevuelta =
              detallesDevueltos
                .filter(
                  item =>
                    item.producto_id ===
                    detalle.producto_id,
                )
                .reduce(
                  (
                    total,
                    item,
                  ) =>
                    total +
                    Number(
                      item.cantidad_devuelta,
                    ),
                  0,
                )


            const disponible =
              Math.max(
                recibida -
                  yaDevuelta,
                0,
              )


            return {
              productoId:
                detalle.producto_id,

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

              cantidadRecibida:
                recibida,

              cantidadDevueltaAnterior:
                yaDevuelta,

              cantidadDisponible:
                disponible,

              cantidadDevolver:
                '0',
            }
          },
        )


      const disponibles =
        itemsCalculados.filter(
          item =>
            item.cantidadDisponible >
            0,
        )


      if (
        disponibles.length ===
        0
      ) {
        throw new Error(
          `La compra ${compra.numero} ya no tiene productos disponibles para devolución.`,
        )
      }


      setCompraSeleccionada(
        compra,
      )

      setItems(
        disponibles,
      )

      setFechaDevolucion(
        fechaLocalActual(),
      )

      setMotivo('')
      setObservaciones('')
    } catch (err) {
      setError(
        obtenerMensajeError(
          err,
          'No fue posible cargar los productos disponibles para devolución.',
        ),
      )
    } finally {
      setCargandoDetalle(
        false,
      )
    }
  }


  // ==========================================================
  // CERRAR DEVOLUCIÓN
  // ==========================================================

  function cerrarDevolucion() {
    if (guardando) {
      return
    }

    setCompraSeleccionada(
      null,
    )

    setItems([])

    setMotivo('')

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
    setItems(
      actuales =>
        actuales.map(
          item =>
            item.productoId ===
            productoId
              ? {
                  ...item,
                  cantidadDevolver:
                    valor,
                }
              : item,
        ),
    )
  }


  // ==========================================================
  // REGISTRAR DEVOLUCIÓN
  // ==========================================================

  async function registrarDevolucion() {
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
        !fechaDevolucion
      ) {
        throw new Error(
          'Seleccione la fecha de devolución.',
        )
      }


      if (
        motivo
          .trim()
          .length < 3
      ) {
        throw new Error(
          'Debe indicar un motivo válido de al menos 3 caracteres.',
        )
      }


      const itemsSeleccionados =
        items.filter(
          item =>
            Number(
              item.cantidadDevolver,
            ) > 0,
        )


      if (
        itemsSeleccionados.length ===
        0
      ) {
        throw new Error(
          'Indique al menos un producto y una cantidad para devolver.',
        )
      }


      for (
        const item of
        itemsSeleccionados
      ) {
        const cantidad =
          Number(
            item.cantidadDevolver,
          )


        if (
          !Number.isFinite(
            cantidad,
          ) ||
          cantidad <= 0
        ) {
          throw new Error(
            `La cantidad a devolver de ${item.nombre} debe ser mayor que cero.`,
          )
        }


        if (
          cantidad >
          item.cantidadDisponible
        ) {
          throw new Error(
            `No puede devolver ${cantidad} de ${item.nombre}. Disponible para devolución: ${item.cantidadDisponible}.`,
          )
        }


        if (
          item.unidad
            .trim()
            .toLowerCase() ===
            'unidad' &&
          !Number.isInteger(
            cantidad,
          )
        ) {
          throw new Error(
            `La cantidad a devolver de ${item.nombre} debe ser un número entero.`,
          )
        }
      }


      const itemsRpc =
        itemsSeleccionados.map(
          item => ({
            producto_id:
              item.productoId,

            cantidad_devuelta:
              Number(
                item.cantidadDevolver,
              ),
          }),
        )


      const {
        data,
        error,
      } =
        await supabase.rpc(
          'registrar_devolucion_compra',
          {
            p_compra_id:
              compraSeleccionada.id,

            p_items:
              itemsRpc,

            p_motivo:
              motivo.trim(),

            p_fecha_devolucion:
              fechaDevolucion,

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
        compraSeleccionada.numero


      setCompraSeleccionada(
        null,
      )

      setItems([])

      setMotivo('')

      setObservaciones('')


      await Promise.all([
        cargarComprasRecibidas(),
        cargarHistorial(),
      ])


      setMensaje(
        `Devolución ${numero} registrada correctamente para la compra ${compraNumero}.`,
      )
    } catch (err) {
      setError(
        obtenerMensajeError(
          err,
          'No fue posible registrar la devolución.',
        ),
      )
    } finally {
      setGuardando(
        false,
      )
    }
  }


  // ==========================================================
  // VER DETALLE DE DEVOLUCIÓN
  // ==========================================================

  async function verDetalleDevolucion(
    devolucion:
      DevolucionHistorial,
  ) {
    try {
      setCargandoHistorialDetalle(
        true,
      )

      setError('')
      setMensaje('')

      setCompraSeleccionada(
        null,
      )

      setItems([])

      setDevolucionSeleccionada(
        devolucion,
      )


      const {
        data,
        error,
      } =
        await supabase
          .from(
            'detalle_devoluciones_compra',
          )
          .select(`
            id,
            producto_id,
            cantidad_devuelta,
            productos (
              codigo,
              nombre,
              unidad_medida
            )
          `)
          .eq(
            'devolucion_id',
            devolucion.id,
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


      const respuesta =
        (
          data ??
          []
        ) as unknown as DetalleDevolucionRespuesta[]


      const detalle =
        respuesta.map(
          (
            item,
          ): DetalleDevolucionVista => {
            const producto =
              obtenerProducto(
                item.productos,
              )

            return {
              id:
                item.id,

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

              cantidadDevuelta:
                Number(
                  item.cantidad_devuelta,
                ) || 0,
            }
          },
        )


      setDetalleDevolucion(
        detalle,
      )
    } catch (err) {
      setError(
        obtenerMensajeError(
          err,
          'No fue posible cargar el detalle de la devolución.',
        ),
      )
    } finally {
      setCargandoHistorialDetalle(
        false,
      )
    }
  }


  function cerrarDetalleDevolucion() {
    setDevolucionSeleccionada(
      null,
    )

    setDetalleDevolucion(
      [],
    )
  }


  // ==========================================================
  // INTERFAZ
  // ==========================================================

  if (cargando) {
    return (
      <div className="inventory-module">
        <div className="inventory-toolbar">
          Cargando devoluciones...
        </div>
      </div>
    )
  }


  return (
    <div className="inventory-module">

      {/* ====================================================
          ENCABEZADO
      ==================================================== */}

      <div className="inventory-toolbar">
        <div>
          <span className="panel-label">
            COMPRAS · DEVOLUCIONES
          </span>

          <h2>
            Devoluciones de compra
          </h2>

          <p>
            Registra productos devueltos al proveedor y actualiza automáticamente el inventario.
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
            COMPRAS RECIBIDAS
          </span>

          <strong>
            {
              comprasRecibidas.length
            }
          </strong>

          <small>
            disponibles para revisión
          </small>
        </div>


        <div className="inventory-stat-card">
          <span>
            DEVOLUCIONES REGISTRADAS
          </span>

          <strong>
            {
              devoluciones.length
            }
          </strong>

          <small>
            historial acumulado
          </small>
        </div>


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
            para devolución
          </small>
        </div>


        <div className="inventory-stat-card">
          <span>
            PRODUCTOS DISPONIBLES
          </span>

          <strong>
            {
              items.length
            }
          </strong>

          <small>
            líneas para devolver
          </small>
        </div>
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
          REGISTRAR DEVOLUCIÓN
      ==================================================== */}

      {compraSeleccionada && (
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
                  REGISTRAR DEVOLUCIÓN
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
                </p>
              </div>


              <button
                type="button"
                className="secondary-button"
                onClick={
                  cerrarDevolucion
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
                Fecha de devolución *

                <input
                  type="date"
                  value={
                    fechaDevolucion
                  }
                  onChange={
                    event =>
                      setFechaDevolucion(
                        event
                          .target
                          .value,
                      )
                  }
                />
              </label>


              <label>
                Motivo *

                <input
                  type="text"
                  value={
                    motivo
                  }
                  onChange={
                    event =>
                      setMotivo(
                        event
                          .target
                          .value,
                      )
                  }
                  placeholder="Ej. Producto defectuoso"
                />
              </label>
            </div>


            <label>
              Observaciones

              <textarea
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
                placeholder="Información adicional de la devolución..."
              />
            </label>


            <div
              className="inventory-table-wrapper"
              style={{
                marginTop:
                  '20px',
              }}
            >
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
                      RECIBIDA
                    </th>

                    <th>
                      DEVUELTA ANTES
                    </th>

                    <th>
                      DISPONIBLE
                    </th>

                    <th>
                      DEVOLVER
                    </th>
                  </tr>
                </thead>


                <tbody>
                  {cargandoDetalle && (
                    <tr>
                      <td
                        colSpan={
                          7
                        }
                        style={{
                          textAlign:
                            'center',
                          padding:
                            '30px',
                        }}
                      >
                        Cargando productos...
                      </td>
                    </tr>
                  )}


                  {!cargandoDetalle &&
                    items.map(
                      item => (
                        <tr
                          key={
                            item.productoId
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
                              item.cantidadRecibida
                            }
                          </td>


                          <td>
                            {
                              item.cantidadDevueltaAnterior
                            }
                          </td>


                          <td>
                            <strong>
                              {
                                item.cantidadDisponible
                              }
                            </strong>
                          </td>


                          <td>
                            <input
                              type="number"
                              min="0"
                              max={
                                item.cantidadDisponible
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
                                item.cantidadDevolver
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
                                  '100px',
                              }}
                            />
                          </td>
                        </tr>
                      ),
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
                  cerrarDevolucion
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
                  void registrarDevolucion()
                }
                disabled={
                  guardando ||
                  cargandoDetalle
                }
              >
                {guardando
                  ? 'Registrando...'
                  : 'Confirmar devolución'}
              </button>
            </div>
          </div>
        </div>
      )}


      {/* ====================================================
          DETALLE DE DEVOLUCIÓN
      ==================================================== */}

      {devolucionSeleccionada && (
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
                  '20px',
              }}
            >
              <div>
                <span className="panel-label">
                  DETALLE DE DEVOLUCIÓN
                </span>

                <h2>
                  {
                    devolucionSeleccionada.numero
                  }
                </h2>

                <p>
                  Compra{' '}
                  {
                    devolucionSeleccionada.compraNumero
                  }
                  {' · '}
                  {
                    devolucionSeleccionada.proveedorNombre
                  }
                </p>
              </div>


              <button
                type="button"
                className="secondary-button"
                onClick={
                  cerrarDetalleDevolucion
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
                  '18px',
                marginBottom:
                  '18px',
              }}
            >
              <div>
                <span className="panel-label">
                  FECHA
                </span>

                <strong>
                  {
                    devolucionSeleccionada.fechaDevolucion
                  }
                </strong>
              </div>


              <div>
                <span className="panel-label">
                  MOTIVO
                </span>

                <strong>
                  {
                    devolucionSeleccionada.motivo
                  }
                </strong>
              </div>
            </div>


            {devolucionSeleccionada
              .observaciones && (
              <p
                style={{
                  marginBottom:
                    '18px',
                }}
              >
                {
                  devolucionSeleccionada.observaciones
                }
              </p>
            )}


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
                      CANTIDAD DEVUELTA
                    </th>
                  </tr>
                </thead>


                <tbody>
                  {cargandoHistorialDetalle && (
                    <tr>
                      <td
                        colSpan={
                          4
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


                  {!cargandoHistorialDetalle &&
                    detalleDevolucion.map(
                      detalle => (
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
                                detalle.nombre
                              }
                            </strong>
                          </td>

                          <td>
                            {
                              detalle.unidad
                            }
                          </td>

                          <td>
                            {
                              detalle.cantidadDevuelta
                            }
                          </td>
                        </tr>
                      ),
                    )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}


      {/* ====================================================
          COMPRAS DISPONIBLES
      ==================================================== */}

      <div
        style={{
          marginTop:
            '6px',
        }}
      >
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
            marginBottom:
              '12px',
          }}
        >
          <div>
            <span className="panel-label">
              COMPRAS RECIBIDAS
            </span>

            <h2
              style={{
                margin:
                  '4px 0 0',
              }}
            >
              Productos disponibles para devolución
            </h2>
          </div>
        </div>


        <div
          style={{
            display:
              'flex',
            justifyContent:
              'space-between',
            alignItems:
              'center',
            gap:
              '20px',
          }}
        >
          <input
            type="search"
            className="inventory-search"
            placeholder="⌕  Buscar compra o proveedor..."
            value={
              busquedaCompras
            }
            onChange={
              event =>
                setBusquedaCompras(
                  event
                    .target
                    .value,
                )
            }
          />

          <span
            style={{
              fontSize:
                '11px',
              color:
                '#7b8494',
            }}
          >
            {
              comprasFiltradas.length
            }{' '}
            {comprasFiltradas.length ===
            1
              ? 'compra'
              : 'compras'}
          </span>
        </div>


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
                  PROVEEDOR
                </th>

                <th>
                  TOTAL
                </th>

                <th>
                  ESTADO
                </th>

                <th>
                  ACCIÓN
                </th>
              </tr>
            </thead>


            <tbody>
              {comprasFiltradas.length ===
                0 && (
                <tr>
                  <td
                    colSpan={
                      6
                    }
                    style={{
                      textAlign:
                        'center',
                      padding:
                        '40px',
                    }}
                  >
                    No hay compras recibidas para mostrar.
                  </td>
                </tr>
              )}


              {comprasFiltradas.map(
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
                      <strong>
                        {
                          compra.proveedorNombre
                        }
                      </strong>

                      <div
                        style={{
                          fontSize:
                            '10px',
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
                      <span className="status-badge status-success">
                        Recibida
                      </span>
                    </td>


                    <td>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() =>
                          void abrirDevolucion(
                            compra,
                          )
                        }
                      >
                        Devolver
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </div>


      {/* ====================================================
          HISTORIAL
      ==================================================== */}

      <div
        style={{
          marginTop:
            '28px',
        }}
      >
        <div>
          <span className="panel-label">
            HISTORIAL
          </span>

          <h2
            style={{
              margin:
                '4px 0 14px',
            }}
          >
            Devoluciones registradas
          </h2>
        </div>


        <div
          style={{
            display:
              'flex',
            justifyContent:
              'space-between',
            alignItems:
              'center',
            gap:
              '20px',
          }}
        >
          <input
            type="search"
            className="inventory-search"
            placeholder="⌕  Buscar devolución, compra o proveedor..."
            value={
              busquedaHistorial
            }
            onChange={
              event =>
                setBusquedaHistorial(
                  event
                    .target
                    .value,
                )
            }
          />

          <span
            style={{
              fontSize:
                '11px',
              color:
                '#7b8494',
            }}
          >
            {
              historialFiltrado.length
            }{' '}
            {historialFiltrado.length ===
            1
              ? 'devolución'
              : 'devoluciones'}
          </span>
        </div>


        <div className="inventory-table-wrapper">
          <table className="inventory-table">
            <thead>
              <tr>
                <th>
                  DEVOLUCIÓN
                </th>

                <th>
                  FECHA
                </th>

                <th>
                  COMPRA
                </th>

                <th>
                  PROVEEDOR
                </th>

                <th>
                  MOTIVO
                </th>

                <th>
                  ACCIÓN
                </th>
              </tr>
            </thead>


            <tbody>
              {historialFiltrado.length ===
                0 && (
                <tr>
                  <td
                    colSpan={
                      6
                    }
                    style={{
                      textAlign:
                        'center',
                      padding:
                        '40px',
                    }}
                  >
                    Todavía no hay devoluciones registradas.
                  </td>
                </tr>
              )}


              {historialFiltrado.map(
                devolucion => (
                  <tr
                    key={
                      devolucion.id
                    }
                  >
                    <td>
                      <strong>
                        {
                          devolucion.numero
                        }
                      </strong>
                    </td>


                    <td>
                      {
                        devolucion.fechaDevolucion
                      }
                    </td>


                    <td>
                      {
                        devolucion.compraNumero
                      }
                    </td>


                    <td>
                      <strong>
                        {
                          devolucion.proveedorNombre
                        }
                      </strong>

                      <div
                        style={{
                          fontSize:
                            '10px',
                          color:
                            '#8a93a3',
                          marginTop:
                            '3px',
                        }}
                      >
                        {
                          devolucion.proveedorCodigo
                        }
                      </div>
                    </td>


                    <td>
                      {
                        devolucion.motivo
                      }
                    </td>


                    <td>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          void verDetalleDevolucion(
                            devolucion,
                          )
                        }
                      >
                        Ver detalle
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}