import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import { supabase } from '../lib/supabase'

type CategoriaRelacion = {
  nombre: string
}

type ExistenciaRelacion = {
  cantidad: number
}

type ProductoRespuesta = {
  id: number
  codigo: string
  nombre: string
  precio_venta: number
  activo: boolean

  categorias:
    | CategoriaRelacion
    | CategoriaRelacion[]
    | null

  existencias:
    | ExistenciaRelacion
    | ExistenciaRelacion[]
    | null
}

type ProductoVenta = {
  id: number
  codigo: string
  nombre: string
  categoria: string
  precio: number
  existencia: number
}

type ItemCarrito = {
  producto: ProductoVenta
  cantidad: number
}

type ResultadoVenta = {
  venta_id: number
  numero: string
  total: number
  cambio: number
}

type MetodoPago =
  | 'efectivo'
  | 'tarjeta'
  | 'transferencia'

function obtenerCategoria(
  relacion:
    | CategoriaRelacion
    | CategoriaRelacion[]
    | null,
) {
  if (!relacion) {
    return 'Sin categoría'
  }

  if (Array.isArray(relacion)) {
    return (
      relacion[0]?.nombre ??
      'Sin categoría'
    )
  }

  return relacion.nombre
}

function obtenerExistencia(
  relacion:
    | ExistenciaRelacion
    | ExistenciaRelacion[]
    | null,
) {
  if (!relacion) {
    return 0
  }

  if (Array.isArray(relacion)) {
    return Number(
      relacion[0]?.cantidad ?? 0,
    )
  }

  return Number(
    relacion.cantidad ?? 0,
  )
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

export default function SalesModule() {
  const [
    productos,
    setProductos,
  ] = useState<ProductoVenta[]>([])

  const [
    carrito,
    setCarrito,
  ] = useState<ItemCarrito[]>([])

  const [
    busqueda,
    setBusqueda,
  ] = useState('')

  const [
    cliente,
    setCliente,
  ] = useState('')

  const [
    referencia,
    setReferencia,
  ] = useState('')

  const [
    metodoPago,
    setMetodoPago,
  ] =
    useState<MetodoPago>(
      'efectivo',
    )

  const [
    montoRecibido,
    setMontoRecibido,
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
    ultimaVenta,
    setUltimaVenta,
  ] =
    useState<ResultadoVenta | null>(
      null,
    )

  async function cargarProductos() {
    setCargando(true)
    setError('')

    const { data, error } =
      await supabase
        .from('productos')
        .select(`
          id,
          codigo,
          nombre,
          precio_venta,
          activo,
          categorias (
            nombre
          ),
          existencias (
            cantidad
          )
        `)
        .eq('activo', true)
        .order('nombre', {
          ascending: true,
        })

    if (error) {
      setProductos([])

      setError(
        `No fue posible cargar los productos: ${error.message}`,
      )

      setCargando(false)
      return
    }

    const respuesta =
      (data ??
        []) as unknown as ProductoRespuesta[]

    const lista =
      respuesta.map(
        (
          producto,
        ): ProductoVenta => ({
          id:
            producto.id,

          codigo:
            producto.codigo,

          nombre:
            producto.nombre,

          categoria:
            obtenerCategoria(
              producto.categorias,
            ),

          precio:
            Number(
              producto.precio_venta ??
                0,
            ),

          existencia:
            obtenerExistencia(
              producto.existencias,
            ),
        }),
      )

    setProductos(lista)
    setCargando(false)
  }

  useEffect(() => {
    cargarProductos()
  }, [])

  const productosFiltrados =
    useMemo(() => {
      const termino =
        busqueda
          .trim()
          .toLowerCase()

      if (!termino) {
        return productos
      }

      return productos.filter(
        (producto) =>
          producto.codigo
            .toLowerCase()
            .includes(termino) ||
          producto.nombre
            .toLowerCase()
            .includes(termino) ||
          producto.categoria
            .toLowerCase()
            .includes(termino),
      )
    }, [
      productos,
      busqueda,
    ])

  const total =
    useMemo(() => {
      return carrito.reduce(
        (
          acumulado,
          item,
        ) =>
          acumulado +
          item.producto.precio *
            item.cantidad,
        0,
      )
    }, [carrito])

  const recibido =
    Number(
      montoRecibido || 0,
    )

  const cambio =
    metodoPago === 'efectivo'
      ? Math.max(
          recibido - total,
          0,
        )
      : 0

  const cantidadItems =
    carrito.reduce(
      (
        totalCantidad,
        item,
      ) =>
        totalCantidad +
        item.cantidad,
      0,
    )

  function agregarProducto(
    producto: ProductoVenta,
  ) {
    setError('')
    setExito('')
    setUltimaVenta(null)

    if (
      producto.existencia <= 0
    ) {
      setError(
        `${producto.nombre} no tiene existencia disponible.`,
      )

      return
    }

    setCarrito(
      (actual) => {
        const existente =
          actual.find(
            (item) =>
              item.producto.id ===
              producto.id,
          )

        if (existente) {
          if (
            existente.cantidad >=
            producto.existencia
          ) {
            setError(
              `No puedes agregar más unidades de ${producto.nombre}. Existencia disponible: ${producto.existencia}.`,
            )

            return actual
          }

          return actual.map(
            (item) =>
              item.producto.id ===
              producto.id
                ? {
                    ...item,
                    cantidad:
                      item.cantidad +
                      1,
                  }
                : item,
          )
        }

        return [
          ...actual,
          {
            producto,
            cantidad: 1,
          },
        ]
      },
    )
  }

  function cambiarCantidad(
    productoId: number,
    nuevaCantidad: number,
  ) {
    setError('')
    setExito('')

    if (nuevaCantidad <= 0) {
      setCarrito(
        (actual) =>
          actual.filter(
            (item) =>
              item.producto.id !==
              productoId,
          ),
      )

      return
    }

    setCarrito(
      (actual) =>
        actual.map(
          (item) => {
            if (
              item.producto.id !==
              productoId
            ) {
              return item
            }

            if (
              nuevaCantidad >
              item.producto
                .existencia
            ) {
              setError(
                `Existencia insuficiente para ${item.producto.nombre}. Disponible: ${item.producto.existencia}.`,
              )

              return item
            }

            return {
              ...item,
              cantidad:
                nuevaCantidad,
            }
          },
        ),
    )
  }

  function quitarProducto(
    productoId: number,
  ) {
    setCarrito(
      (actual) =>
        actual.filter(
          (item) =>
            item.producto.id !==
            productoId,
        ),
    )
  }

  function limpiarVenta() {
    setCarrito([])
    setCliente('')
    setReferencia('')
    setMetodoPago('efectivo')
    setMontoRecibido('')
    setError('')
    setExito('')
    setUltimaVenta(null)
  }

  async function registrarVenta() {
    setError('')
    setExito('')
    setUltimaVenta(null)

    if (
      carrito.length === 0
    ) {
      setError(
        'Agrega al menos un producto a la venta.',
      )

      return
    }

    if (total <= 0) {
      setError(
        'El total de la venta debe ser mayor que cero.',
      )

      return
    }

    if (
      metodoPago ===
        'efectivo' &&
      recibido < total
    ) {
      setError(
        `El monto recibido es insuficiente. Total: ${formatearCordobas(total)}.`,
      )

      return
    }

    setProcesando(true)

    const items =
      carrito.map(
        (item) => ({
          producto_id:
            item.producto.id,

          cantidad:
            item.cantidad,
        }),
      )

    const {
      data,
      error,
    } = await supabase.rpc(
      'registrar_venta',
      {
        p_items:
          items,

        p_metodo_pago:
          metodoPago,

        p_monto_recibido:
          metodoPago ===
          'efectivo'
            ? recibido
            : null,

        p_cliente_nombre:
          cliente.trim() ||
          null,

        p_referencia:
          referencia.trim() ||
          null,
      },
    )

    if (error) {
      setError(
        error.message,
      )

      setProcesando(false)

      return
    }

    const resultado =
      Array.isArray(data)
        ? data[0]
        : data

    if (!resultado) {
      setError(
        'La venta fue procesada, pero no se recibió la respuesta esperada.',
      )

      setProcesando(false)

      return
    }

    const venta:
      ResultadoVenta = {
      venta_id:
        Number(
          resultado.venta_id,
        ),

      numero:
        String(
          resultado.numero,
        ),

      total:
        Number(
          resultado.total,
        ),

      cambio:
        Number(
          resultado.cambio,
        ),
    }

    setUltimaVenta(
      venta,
    )

    setExito(
      `Venta ${venta.numero} registrada correctamente.`,
    )

    setCarrito([])
    setCliente('')
    setReferencia('')
    setMontoRecibido('')
    setMetodoPago(
      'efectivo',
    )

    await cargarProductos()

    setProcesando(false)
  }

  if (cargando) {
    return (
      <div className="inventory-loading">
        <div className="inventory-spinner" />

        <span>
          Cargando punto de venta...
        </span>
      </div>
    )
  }

  return (
    <div className="sales-module">
      {/* =============================================
          ENCABEZADO
      ============================================= */}

      <div className="sales-toolbar">
        <div>
          <span className="panel-label">
            PUNTO DE VENTA
          </span>

          <h2>
            Registrar venta
          </h2>

          <p>
            Selecciona productos,
            confirma el pago y registra
            la operación.
          </p>
        </div>

        <button
          type="button"
          className="inventory-refresh-button"
          onClick={
            cargarProductos
          }
        >
          ↻ Actualizar productos
        </button>
      </div>

      {/* =============================================
          RESUMEN SUPERIOR
      ============================================= */}

      <div className="sales-summary-grid">
        <article className="sales-summary-card">
          <span>
            PRODUCTOS
          </span>

          <strong>
            {
              productos.length
            }
          </strong>

          <p>
            disponibles en catálogo
          </p>
        </article>

        <article className="sales-summary-card">
          <span>
            EN CARRITO
          </span>

          <strong>
            {
              cantidadItems
            }
          </strong>

          <p>
            unidades
          </p>
        </article>

        <article className="sales-summary-card">
          <span>
            TOTAL
          </span>

          <strong>
            {formatearCordobas(
              total,
            )}
          </strong>

          <p>
            venta actual
          </p>
        </article>

        <article className="sales-summary-card">
          <span>
            CAMBIO
          </span>

          <strong>
            {formatearCordobas(
              cambio,
            )}
          </strong>

          <p>
            devolución al cliente
          </p>
        </article>
      </div>

      {/* =============================================
          MENSAJES
      ============================================= */}

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

      {ultimaVenta && (
        <section className="sales-success-card">
          <div className="sales-success-icon">
            ✓
          </div>

          <div>
            <span>
              VENTA COMPLETADA
            </span>

            <h3>
              {
                ultimaVenta.numero
              }
            </h3>

            <p>
              Total{' '}
              <strong>
                {formatearCordobas(
                  ultimaVenta.total,
                )}
              </strong>

              {ultimaVenta.cambio >
                0 && (
                <>
                  {' · '}Cambio{' '}
                  <strong>
                    {formatearCordobas(
                      ultimaVenta.cambio,
                    )}
                  </strong>
                </>
              )}
            </p>
          </div>
        </section>
      )}

      {/* =============================================
          CONTENIDO PRINCIPAL
      ============================================= */}

      <div className="sales-workspace">
        {/* ===========================================
            PRODUCTOS
        =========================================== */}

        <section className="sales-products-panel">
          <div className="sales-panel-head">
            <div>
              <span className="panel-label">
                CATÁLOGO
              </span>

              <h3>
                Productos
              </h3>
            </div>

            <span className="sales-result-count">
              {
                productosFiltrados.length
              }{' '}
              resultado
              {productosFiltrados.length ===
              1
                ? ''
                : 's'}
            </span>
          </div>

          <div className="sales-search">
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
              placeholder="Buscar por código, producto o categoría..."
            />
          </div>

          <div className="sales-product-list">
            {productosFiltrados.length >
            0 ? (
              productosFiltrados.map(
                (producto) => {
                  const sinExistencia =
                    producto.existencia <=
                    0

                  return (
                    <article
                      className="sales-product-row"
                      key={
                        producto.id
                      }
                    >
                      <div className="sales-product-main">
                        <span className="product-code">
                          {
                            producto.codigo
                          }
                        </span>

                        <strong>
                          {
                            producto.nombre
                          }
                        </strong>

                        <small>
                          {
                            producto.categoria
                          }
                        </small>
                      </div>

                      <div className="sales-product-stock">
                        <span>
                          Existencia
                        </span>

                        <strong
                          className={
                            sinExistencia
                              ? 'sales-stock sales-stock--empty'
                              : 'sales-stock'
                          }
                        >
                          {
                            producto.existencia
                          }
                        </strong>
                      </div>

                      <div className="sales-product-price">
                        <span>
                          Precio
                        </span>

                        <strong>
                          {formatearCordobas(
                            producto.precio,
                          )}
                        </strong>
                      </div>

                      <button
                        type="button"
                        className="sales-add-button"
                        disabled={
                          sinExistencia
                        }
                        onClick={() =>
                          agregarProducto(
                            producto,
                          )
                        }
                      >
                        {sinExistencia
                          ? 'Sin stock'
                          : '+ Agregar'}
                      </button>
                    </article>
                  )
                },
              )
            ) : (
              <div className="inventory-empty">
                No se encontraron
                productos.
              </div>
            )}
          </div>
        </section>

        {/* ===========================================
            CARRITO
        =========================================== */}

        <section className="sales-cart-panel">
          <div className="sales-panel-head">
            <div>
              <span className="panel-label">
                VENTA ACTUAL
              </span>

              <h3>
                Carrito
              </h3>
            </div>

            {carrito.length >
              0 && (
              <button
                type="button"
                className="sales-clear-button"
                onClick={
                  limpiarVenta
                }
              >
                Limpiar
              </button>
            )}
          </div>

          <div className="sales-cart-items">
            {carrito.length ===
            0 ? (
              <div className="sales-cart-empty">
                <div>
                  🛒
                </div>

                <strong>
                  Venta vacía
                </strong>

                <p>
                  Agrega productos
                  desde el catálogo.
                </p>
              </div>
            ) : (
              carrito.map(
                (item) => (
                  <article
                    className="sales-cart-item"
                    key={
                      item.producto.id
                    }
                  >
                    <div className="sales-cart-product">
                      <strong>
                        {
                          item.producto
                            .nombre
                        }
                      </strong>

                      <span>
                        {
                          item.producto
                            .codigo
                        }
                      </span>

                      <small>
                        {formatearCordobas(
                          item.producto
                            .precio,
                        )}{' '}
                        c/u
                      </small>
                    </div>

                    <div className="sales-qty">
                      <button
                        type="button"
                        onClick={() =>
                          cambiarCantidad(
                            item.producto
                              .id,
                            item.cantidad -
                              1,
                          )
                        }
                      >
                        −
                      </button>

                      <input
                        type="number"
                        min="1"
                        max={
                          item.producto
                            .existencia
                        }
                        value={
                          item.cantidad
                        }
                        onChange={(
                          event,
                        ) =>
                          cambiarCantidad(
                            item.producto
                              .id,
                            Number(
                              event
                                .target
                                .value,
                            ),
                          )
                        }
                      />

                      <button
                        type="button"
                        onClick={() =>
                          cambiarCantidad(
                            item.producto
                              .id,
                            item.cantidad +
                              1,
                          )
                        }
                      >
                        +
                      </button>
                    </div>

                    <div className="sales-cart-subtotal">
                      <span>
                        Subtotal
                      </span>

                      <strong>
                        {formatearCordobas(
                          item.producto
                            .precio *
                            item.cantidad,
                        )}
                      </strong>
                    </div>

                    <button
                      type="button"
                      className="sales-remove-button"
                      onClick={() =>
                        quitarProducto(
                          item.producto
                            .id,
                        )
                      }
                    >
                      ×
                    </button>
                  </article>
                ),
              )
            )}
          </div>

          <div className="sales-cart-total">
            <span>
              Total de venta
            </span>

            <strong>
              {formatearCordobas(
                total,
              )}
            </strong>
          </div>
        </section>
      </div>

      {/* =============================================
          DATOS DE PAGO
      ============================================= */}

      <section className="sales-payment-card">
        <div className="sales-payment-head">
          <div>
            <span className="panel-label">
              PAGO
            </span>

            <h3>
              Confirmar venta
            </h3>

            <p>
              Completa los datos y
              registra la operación.
            </p>
          </div>

          <strong className="sales-payment-total">
            {formatearCordobas(
              total,
            )}
          </strong>
        </div>

        <div className="sales-payment-grid">
          <div className="sales-field">
            <label htmlFor="venta-cliente">
              Cliente
            </label>

            <input
              id="venta-cliente"
              type="text"
              value={
                cliente
              }
              onChange={(
                event,
              ) =>
                setCliente(
                  event.target
                    .value,
                )
              }
              placeholder="Cliente general"
            />
          </div>

          <div className="sales-field">
            <label htmlFor="venta-referencia">
              Referencia
            </label>

            <input
              id="venta-referencia"
              type="text"
              value={
                referencia
              }
              onChange={(
                event,
              ) =>
                setReferencia(
                  event.target
                    .value,
                )
              }
              placeholder="Opcional"
            />
          </div>

          <div className="sales-field">
            <label htmlFor="venta-metodo">
              Método de pago
            </label>

            <select
              id="venta-metodo"
              value={
                metodoPago
              }
              onChange={(
                event,
              ) => {
                const valor =
                  event.target
                    .value as MetodoPago

                setMetodoPago(
                  valor,
                )

                if (
                  valor !==
                  'efectivo'
                ) {
                  setMontoRecibido(
                    '',
                  )
                }
              }}
            >
              <option value="efectivo">
                Efectivo
              </option>

              <option value="tarjeta">
                Tarjeta
              </option>

              <option value="transferencia">
                Transferencia
              </option>
            </select>
          </div>

          <div className="sales-field">
            <label htmlFor="venta-recibido">
              Monto recibido
            </label>

            <input
              id="venta-recibido"
              type="number"
              min="0"
              step="0.01"
              value={
                montoRecibido
              }
              disabled={
                metodoPago !==
                'efectivo'
              }
              onChange={(
                event,
              ) =>
                setMontoRecibido(
                  event.target
                    .value,
                )
              }
              placeholder={
                metodoPago ===
                'efectivo'
                  ? '0.00'
                  : 'No aplica'
              }
            />
          </div>
        </div>

        <div className="sales-payment-summary">
          <div>
            <span>
              Total
            </span>

            <strong>
              {formatearCordobas(
                total,
              )}
            </strong>
          </div>

          <div>
            <span>
              Recibido
            </span>

            <strong>
              {metodoPago ===
              'efectivo'
                ? formatearCordobas(
                    recibido,
                  )
                : formatearCordobas(
                    total,
                  )}
            </strong>
          </div>

          <div>
            <span>
              Cambio
            </span>

            <strong>
              {formatearCordobas(
                cambio,
              )}
            </strong>
          </div>
        </div>

        <div className="sales-payment-actions">
          <button
            type="button"
            className="product-secondary-button"
            onClick={
              limpiarVenta
            }
            disabled={
              procesando
            }
          >
            Cancelar venta
          </button>

          <button
            type="button"
            className="sales-confirm-button"
            onClick={
              registrarVenta
            }
            disabled={
              procesando ||
              carrito.length ===
                0
            }
          >
            {procesando
              ? 'Procesando...'
              : `Confirmar venta · ${formatearCordobas(total)}`}
          </button>
        </div>
      </section>
    </div>
  )
}