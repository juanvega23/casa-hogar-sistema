import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'

import { supabase } from '../lib/supabase'

type ExistenciaRelacion = {
  cantidad: number
}

type ProductoRespuesta = {
  id: number
  codigo: string
  nombre: string
  activo: boolean
  existencias:
    | ExistenciaRelacion
    | ExistenciaRelacion[]
    | null
}

type Producto = {
  id: number
  codigo: string
  nombre: string
  existencia: number
}

type ProductoMovimientoRelacion = {
  codigo: string
  nombre: string
}

type MovimientoRespuesta = {
  id: number
  producto_id: number
  tipo: string
  cantidad: number
  cantidad_anterior: number
  cantidad_nueva: number
  motivo: string | null
  referencia: string | null
  created_at: string

  productos:
    | ProductoMovimientoRelacion
    | ProductoMovimientoRelacion[]
    | null
}

type Movimiento = {
  id: number
  productoId: number
  codigo: string
  producto: string
  tipo: string
  cantidad: number
  cantidadAnterior: number
  cantidadNueva: number
  motivo: string
  referencia: string
  fecha: string
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

function obtenerProductoMovimiento(
  relacion:
    | ProductoMovimientoRelacion
    | ProductoMovimientoRelacion[]
    | null,
) {
  if (!relacion) {
    return {
      codigo: '—',
      nombre: 'Producto no disponible',
    }
  }

  if (Array.isArray(relacion)) {
    return {
      codigo:
        relacion[0]?.codigo ?? '—',

      nombre:
        relacion[0]?.nombre ??
        'Producto no disponible',
    }
  }

  return relacion
}

function nombreTipoMovimiento(
  tipo: string,
) {
  const nombres: Record<
    string,
    string
  > = {
    entrada: 'Entrada',
    salida: 'Salida',
    ajuste_positivo:
      'Ajuste positivo',
    ajuste_negativo:
      'Ajuste negativo',
  }

  return nombres[tipo] ?? tipo
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

export default function MovementsModule() {
  const [productos, setProductos] =
    useState<Producto[]>([])

  const [
    movimientos,
    setMovimientos,
  ] = useState<Movimiento[]>([])

  const [
    productoId,
    setProductoId,
  ] = useState('')

  const [tipo, setTipo] =
    useState('entrada')

  const [cantidad, setCantidad] =
    useState('')

  const [motivo, setMotivo] =
    useState('')

  const [
    referencia,
    setReferencia,
  ] = useState('')

  const [busqueda, setBusqueda] =
    useState('')

  const [cargando, setCargando] =
    useState(true)

  const [
    registrando,
    setRegistrando,
  ] = useState(false)

  const [error, setError] =
    useState('')

  const [exito, setExito] =
    useState('')

  async function cargarDatos() {
    setCargando(true)
    setError('')

    const [
      productosResultado,
      movimientosResultado,
    ] = await Promise.all([
      supabase
        .from('productos')
        .select(`
          id,
          codigo,
          nombre,
          activo,
          existencias (
            cantidad
          )
        `)
        .eq('activo', true)
        .order('nombre', {
          ascending: true,
        }),

      supabase
        .from(
          'movimientos_inventario',
        )
        .select(`
          id,
          producto_id,
          tipo,
          cantidad,
          cantidad_anterior,
          cantidad_nueva,
          motivo,
          referencia,
          created_at,
          productos (
            codigo,
            nombre
          )
        `)
        .order('created_at', {
          ascending: false,
        }),
    ])

    if (productosResultado.error) {
      setError(
        `No fue posible cargar los productos: ${productosResultado.error.message}`,
      )

      setCargando(false)

      return
    }

    if (movimientosResultado.error) {
      setError(
        `No fue posible cargar los movimientos: ${movimientosResultado.error.message}`,
      )

      setCargando(false)

      return
    }

    const productosRespuesta =
      (productosResultado.data ??
        []) as unknown as ProductoRespuesta[]

    const productosNormalizados =
      productosRespuesta.map(
        (producto): Producto => ({
          id: producto.id,
          codigo: producto.codigo,
          nombre: producto.nombre,

          existencia:
            obtenerExistencia(
              producto.existencias,
            ),
        }),
      )

    const movimientosRespuesta =
      (movimientosResultado.data ??
        []) as unknown as MovimientoRespuesta[]

    const movimientosNormalizados =
      movimientosRespuesta.map(
        (
          movimiento,
        ): Movimiento => {
          const producto =
            obtenerProductoMovimiento(
              movimiento.productos,
            )

          return {
            id: movimiento.id,

            productoId:
              movimiento.producto_id,

            codigo:
              producto.codigo,

            producto:
              producto.nombre,

            tipo:
              movimiento.tipo,

            cantidad:
              Number(
                movimiento.cantidad,
              ),

            cantidadAnterior:
              Number(
                movimiento.cantidad_anterior,
              ),

            cantidadNueva:
              Number(
                movimiento.cantidad_nueva,
              ),

            motivo:
              movimiento.motivo ??
              '—',

            referencia:
              movimiento.referencia ??
              '—',

            fecha:
              movimiento.created_at,
          }
        },
      )

    setProductos(
      productosNormalizados,
    )

    setMovimientos(
      movimientosNormalizados,
    )

    if (
      !productoId &&
      productosNormalizados.length > 0
    ) {
      setProductoId(
        String(
          productosNormalizados[0].id,
        ),
      )
    }

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  const productoSeleccionado =
    useMemo(
      () =>
        productos.find(
          (producto) =>
            producto.id ===
            Number(productoId),
        ) ?? null,
      [
        productos,
        productoId,
      ],
    )

  const movimientosFiltrados =
    useMemo(() => {
      const termino =
        busqueda
          .trim()
          .toLowerCase()

      if (!termino) {
        return movimientos
      }

      return movimientos.filter(
        (movimiento) =>
          movimiento.codigo
            .toLowerCase()
            .includes(termino) ||
          movimiento.producto
            .toLowerCase()
            .includes(termino) ||
          movimiento.tipo
            .toLowerCase()
            .includes(termino) ||
          movimiento.referencia
            .toLowerCase()
            .includes(termino) ||
          movimiento.motivo
            .toLowerCase()
            .includes(termino),
      )
    }, [
      movimientos,
      busqueda,
    ])

  const resumen =
    useMemo(() => {
      return {
        total:
          movimientos.length,

        entradas:
          movimientos.filter(
            (movimiento) =>
              movimiento.tipo ===
                'entrada' ||
              movimiento.tipo ===
                'ajuste_positivo',
          ).length,

        salidas:
          movimientos.filter(
            (movimiento) =>
              movimiento.tipo ===
                'salida' ||
              movimiento.tipo ===
                'ajuste_negativo',
          ).length,

        productos:
          new Set(
            movimientos.map(
              (movimiento) =>
                movimiento.productoId,
            ),
          ).size,
      }
    }, [movimientos])

  async function registrarMovimiento(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    setError('')
    setExito('')

    if (!productoSeleccionado) {
      setError(
        'Selecciona un producto.',
      )

      return
    }

    const cantidadNumero =
      Number(cantidad)

    if (
      !Number.isFinite(
        cantidadNumero,
      ) ||
      cantidadNumero <= 0
    ) {
      setError(
        'La cantidad debe ser mayor que cero.',
      )

      return
    }

    const esSalida =
      tipo === 'salida' ||
      tipo === 'ajuste_negativo'

    if (
      esSalida &&
      cantidadNumero >
        productoSeleccionado.existencia
    ) {
      setError(
        `Existencia insuficiente. Disponible: ${productoSeleccionado.existencia}.`,
      )

      return
    }

    setRegistrando(true)

    const { error } =
      await supabase.rpc(
        'registrar_movimiento_inventario',
        {
          p_producto_id:
            productoSeleccionado.id,

          p_tipo:
            tipo,

          p_cantidad:
            cantidadNumero,

          p_motivo:
            motivo.trim() ||
            null,

          p_referencia:
            referencia.trim() ||
            null,
        },
      )

    if (error) {
      setError(
        `No fue posible registrar el movimiento: ${error.message}`,
      )

      setRegistrando(false)

      return
    }

    setExito(
      'Movimiento registrado correctamente.',
    )

    setCantidad('')
    setMotivo('')
    setReferencia('')

    await cargarDatos()

    setRegistrando(false)
  }

  if (cargando) {
    return (
      <div className="inventory-loading">
        <div className="inventory-spinner" />

        <span>
          Cargando movimientos...
        </span>
      </div>
    )
  }

  return (
    <div className="inventory-module">
      {/* ==============================================
          ENCABEZADO
      ============================================== */}

      <div className="inventory-toolbar">
        <div>
          <span className="panel-label">
            CONTROL DE INVENTARIO
          </span>

          <h2>
            Movimientos
          </h2>

          <p>
            Registra entradas,
            salidas y ajustes del
            inventario.
          </p>
        </div>

        <button
          type="button"
          className="inventory-refresh-button"
          onClick={cargarDatos}
        >
          ↻ Actualizar
        </button>
      </div>

      {/* ==============================================
          RESUMEN
      ============================================== */}

      <div className="inventory-summary-grid">
        <article className="inventory-summary-card">
          <span>
            MOVIMIENTOS
          </span>

          <strong>
            {resumen.total}
          </strong>

          <p>
            registrados
          </p>
        </article>

        <article className="inventory-summary-card">
          <span>
            ENTRADAS / AUMENTOS
          </span>

          <strong>
            {resumen.entradas}
          </strong>

          <p>
            movimientos
          </p>
        </article>

        <article className="inventory-summary-card">
          <span>
            SALIDAS / DISMINUCIONES
          </span>

          <strong>
            {resumen.salidas}
          </strong>

          <p>
            movimientos
          </p>
        </article>

        <article className="inventory-summary-card">
          <span>
            PRODUCTOS AFECTADOS
          </span>

          <strong>
            {resumen.productos}
          </strong>

          <p>
            productos
          </p>
        </article>
      </div>

      {/* ==============================================
          FORMULARIO
      ============================================== */}

      <section className="movement-form-card">
        <div className="movement-form-heading">
          <div>
            <span className="panel-label">
              NUEVO MOVIMIENTO
            </span>

            <h3>
              Registrar movimiento
            </h3>

            <p>
              Todos los cambios de
              existencia quedarán
              registrados en el
              historial.
            </p>
          </div>

          {productoSeleccionado && (
            <div className="movement-stock-box">
              <span>
                Existencia actual
              </span>

              <strong>
                {
                  productoSeleccionado.existencia
                }
              </strong>

              <small>
                {
                  productoSeleccionado.codigo
                }
              </small>
            </div>
          )}
        </div>

        <form
          className="movement-form"
          onSubmit={
            registrarMovimiento
          }
        >
          <div className="movement-field">
            <label htmlFor="mov-producto">
              Producto
            </label>

            <select
              id="mov-producto"
              value={productoId}
              onChange={(event) =>
                setProductoId(
                  event.target.value,
                )
              }
              required
            >
              {productos.map(
                (producto) => (
                  <option
                    key={producto.id}
                    value={producto.id}
                  >
                    {producto.codigo}
                    {' — '}
                    {producto.nombre}
                  </option>
                ),
              )}
            </select>
          </div>

          <div className="movement-field">
            <label htmlFor="mov-tipo">
              Tipo
            </label>

            <select
              id="mov-tipo"
              value={tipo}
              onChange={(event) =>
                setTipo(
                  event.target.value,
                )
              }
            >
              <option value="entrada">
                Entrada
              </option>

              <option value="salida">
                Salida
              </option>

              <option value="ajuste_positivo">
                Ajuste positivo
              </option>

              <option value="ajuste_negativo">
                Ajuste negativo
              </option>
            </select>
          </div>

          <div className="movement-field">
            <label htmlFor="mov-cantidad">
              Cantidad
            </label>

            <input
              id="mov-cantidad"
              type="number"
              min="0.01"
              step="0.01"
              value={cantidad}
              onChange={(event) =>
                setCantidad(
                  event.target.value,
                )
              }
              placeholder="0"
              required
            />
          </div>

          <div className="movement-field">
            <label htmlFor="mov-referencia">
              Referencia
            </label>

            <input
              id="mov-referencia"
              type="text"
              value={referencia}
              onChange={(event) =>
                setReferencia(
                  event.target.value,
                )
              }
              placeholder="Ej. AJUSTE-001"
            />
          </div>

          <div className="movement-field movement-field--wide">
            <label htmlFor="mov-motivo">
              Motivo
            </label>

            <input
              id="mov-motivo"
              type="text"
              value={motivo}
              onChange={(event) =>
                setMotivo(
                  event.target.value,
                )
              }
              placeholder="Describe brevemente el motivo del movimiento"
            />
          </div>

          <div className="movement-submit">
            <button
              type="submit"
              disabled={registrando}
            >
              {registrando
                ? 'Registrando...'
                : 'Registrar movimiento'}
            </button>
          </div>
        </form>

        {error && (
          <div className="inventory-error movement-message">
            {error}
          </div>
        )}

        {exito && (
          <div className="movement-success">
            {exito}
          </div>
        )}
      </section>

      {/* ==============================================
          HISTORIAL
      ============================================== */}

      <div className="inventory-search-row">
        <div className="inventory-search">
          <span>⌕</span>

          <input
            type="text"
            value={busqueda}
            onChange={(event) =>
              setBusqueda(
                event.target.value,
              )
            }
            placeholder="Buscar en historial..."
          />
        </div>

        <span className="inventory-result-count">
          {
            movimientosFiltrados.length
          }{' '}
          movimiento
          {movimientosFiltrados.length ===
          1
            ? ''
            : 's'}
        </span>
      </div>

      <div className="inventory-table-container">
        <table className="inventory-table movement-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Producto</th>
              <th>Tipo</th>
              <th>Cantidad</th>
              <th>Anterior</th>
              <th>Nueva</th>
              <th>Referencia</th>
              <th>Motivo</th>
            </tr>
          </thead>

          <tbody>
            {movimientosFiltrados.length >
            0 ? (
              movimientosFiltrados.map(
                (movimiento) => (
                  <tr
                    key={
                      movimiento.id
                    }
                  >
                    <td>
                      {formatearFecha(
                        movimiento.fecha,
                      )}
                    </td>

                    <td>
                      <strong className="product-name">
                        {
                          movimiento.producto
                        }
                      </strong>

                      <div className="movement-product-code">
                        {
                          movimiento.codigo
                        }
                      </div>
                    </td>

                    <td>
                      <span
                        className={
                          movimiento.tipo ===
                            'entrada' ||
                          movimiento.tipo ===
                            'ajuste_positivo'
                            ? 'movement-type movement-type--positive'
                            : 'movement-type movement-type--negative'
                        }
                      >
                        {nombreTipoMovimiento(
                          movimiento.tipo,
                        )}
                      </span>
                    </td>

                    <td>
                      <strong>
                        {
                          movimiento.cantidad
                        }
                      </strong>
                    </td>

                    <td>
                      {
                        movimiento.cantidadAnterior
                      }
                    </td>

                    <td>
                      <strong>
                        {
                          movimiento.cantidadNueva
                        }
                      </strong>
                    </td>

                    <td>
                      {
                        movimiento.referencia
                      }
                    </td>

                    <td>
                      {
                        movimiento.motivo
                      }
                    </td>
                  </tr>
                ),
              )
            ) : (
              <tr>
                <td
                  colSpan={8}
                  className="inventory-empty"
                >
                  No hay movimientos
                  para mostrar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}