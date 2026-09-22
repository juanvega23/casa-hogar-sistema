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
  unidad_medida: string
  precio_venta: number
  stock_minimo: number
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

type ProductoInventario = {
  id: number
  codigo: string
  nombre: string
  categoria: string
  unidadMedida: string
  precioVenta: number
  stockMinimo: number
  existencia: number
  estado:
    | 'Disponible'
    | 'Stock bajo'
    | 'Sin existencia'
}

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

  return Number(relacion.cantidad ?? 0)
}

function obtenerEstado(
  existencia: number,
  stockMinimo: number,
): ProductoInventario['estado'] {
  if (existencia <= 0) {
    return 'Sin existencia'
  }

  if (existencia <= stockMinimo) {
    return 'Stock bajo'
  }

  return 'Disponible'
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

export default function InventoryModule() {
  const [productos, setProductos] =
    useState<ProductoInventario[]>([])

  const [busqueda, setBusqueda] =
    useState('')

  const [cargando, setCargando] =
    useState(true)

  const [error, setError] =
    useState('')

  async function cargarInventario() {
    setCargando(true)
    setError('')

    const { data, error } =
      await supabase
        .from('productos')
        .select(`
          id,
          codigo,
          nombre,
          unidad_medida,
          precio_venta,
          stock_minimo,
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
      setError(
        `No fue posible cargar el inventario: ${error.message}`,
      )

      setProductos([])
      setCargando(false)

      return
    }

    const respuesta =
      (data ??
        []) as unknown as ProductoRespuesta[]

    const inventario =
      respuesta.map(
        (
          producto,
        ): ProductoInventario => {
          const existencia =
            obtenerExistencia(
              producto.existencias,
            )

          const stockMinimo =
            Number(
              producto.stock_minimo ??
                0,
            )

          return {
            id: producto.id,
            codigo:
              producto.codigo,
            nombre:
              producto.nombre,
            categoria:
              obtenerCategoria(
                producto.categorias,
              ),
            unidadMedida:
              producto.unidad_medida,
            precioVenta:
              Number(
                producto.precio_venta ??
                  0,
              ),
            stockMinimo,
            existencia,
            estado:
              obtenerEstado(
                existencia,
                stockMinimo,
              ),
          }
        },
      )

    setProductos(inventario)
    setCargando(false)
  }

  useEffect(() => {
    cargarInventario()
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
    }, [productos, busqueda])

  const resumen =
    useMemo(() => {
      const total =
        productos.length

      const sinExistencia =
        productos.filter(
          (producto) =>
            producto.existencia <= 0,
        ).length

      const stockBajo =
        productos.filter(
          (producto) =>
            producto.existencia > 0 &&
            producto.existencia <=
              producto.stockMinimo,
        ).length

      const disponibles =
        productos.filter(
          (producto) =>
            producto.existencia >
            producto.stockMinimo,
        ).length

      return {
        total,
        disponibles,
        stockBajo,
        sinExistencia,
      }
    }, [productos])

  if (cargando) {
    return (
      <div className="inventory-loading">
        <div className="inventory-spinner" />

        <span>
          Cargando inventario...
        </span>
      </div>
    )
  }

  return (
    <div className="inventory-module">
      {/* ======================================
          ENCABEZADO
      ====================================== */}

      <div className="inventory-toolbar">
        <div>
          <span className="panel-label">
            CATÁLOGO E INVENTARIO
          </span>

          <h2>
            Productos registrados
          </h2>

          <p>
            Consulta de productos,
            existencias y estado del
            inventario.
          </p>
        </div>

        <button
          type="button"
          className="inventory-refresh-button"
          onClick={
            cargarInventario
          }
        >
          ↻ Actualizar
        </button>
      </div>

      {/* ======================================
          RESUMEN
      ====================================== */}

      <div className="inventory-summary-grid">
        <article className="inventory-summary-card">
          <span>
            PRODUCTOS
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
            DISPONIBLES
          </span>

          <strong>
            {resumen.disponibles}
          </strong>

          <p>
            con stock suficiente
          </p>
        </article>

        <article className="inventory-summary-card">
          <span>
            STOCK BAJO
          </span>

          <strong>
            {resumen.stockBajo}
          </strong>

          <p>
            requieren atención
          </p>
        </article>

        <article className="inventory-summary-card">
          <span>
            SIN EXISTENCIA
          </span>

          <strong>
            {resumen.sinExistencia}
          </strong>

          <p>
            productos agotados
          </p>
        </article>
      </div>

      {/* ======================================
          BÚSQUEDA
      ====================================== */}

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
            placeholder="Buscar por código, producto o categoría..."
          />
        </div>

        <span className="inventory-result-count">
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

      {/* ======================================
          ERROR
      ====================================== */}

      {error && (
        <div className="inventory-error">
          {error}
        </div>
      )}

      {/* ======================================
          TABLA
      ====================================== */}

      {!error && (
        <div className="inventory-table-container">
          <table className="inventory-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Producto</th>
                <th>Categoría</th>
                <th>Unidad</th>
                <th>Precio venta</th>
                <th>Existencia</th>
                <th>Stock mínimo</th>
                <th>Estado</th>
              </tr>
            </thead>

            <tbody>
              {productosFiltrados.length >
              0 ? (
                productosFiltrados.map(
                  (producto) => (
                    <tr
                      key={
                        producto.id
                      }
                    >
                      <td>
                        <span className="product-code">
                          {
                            producto.codigo
                          }
                        </span>
                      </td>

                      <td>
                        <strong className="product-name">
                          {
                            producto.nombre
                          }
                        </strong>
                      </td>

                      <td>
                        {
                          producto.categoria
                        }
                      </td>

                      <td>
                        {
                          producto.unidadMedida
                        }
                      </td>

                      <td>
                        {formatearCordobas(
                          producto.precioVenta,
                        )}
                      </td>

                      <td>
                        <strong className="stock-value">
                          {
                            producto.existencia
                          }
                        </strong>
                      </td>

                      <td>
                        {
                          producto.stockMinimo
                        }
                      </td>

                      <td>
                        <span
                          className={
                            producto.estado ===
                            'Disponible'
                              ? 'inventory-status inventory-status-ok'
                              : producto.estado ===
                                  'Stock bajo'
                                ? 'inventory-status inventory-status-warning'
                                : 'inventory-status inventory-status-danger'
                          }
                        >
                          {
                            producto.estado
                          }
                        </span>
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
                    No se encontraron
                    productos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}