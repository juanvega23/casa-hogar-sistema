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
  descripcion: string | null
  unidad_medida: string
  precio_compra: number
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

type Producto = {
  id: number
  codigo: string
  nombre: string
  descripcion: string
  categoria: string
  unidad: string
  precioCompra: number
  precioVenta: number
  stock: number
  stockMinimo: number
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

function obtenerStock(
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

export default function ProductsModule() {
  const [productos, setProductos] =
    useState<Producto[]>([])

  const [busqueda, setBusqueda] =
    useState('')

  const [cargando, setCargando] =
    useState(true)

  const [error, setError] =
    useState('')

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
          descripcion,
          unidad_medida,
          precio_compra,
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
        `No fue posible cargar los productos: ${error.message}`,
      )

      setProductos([])
      setCargando(false)

      return
    }

    const respuesta =
      (data ??
        []) as unknown as ProductoRespuesta[]

    const lista =
      respuesta.map(
        (producto): Producto => ({
          id: producto.id,

          codigo:
            producto.codigo,

          nombre:
            producto.nombre,

          descripcion:
            producto.descripcion ??
            'Sin descripción',

          categoria:
            obtenerCategoria(
              producto.categorias,
            ),

          unidad:
            producto.unidad_medida,

          precioCompra:
            Number(
              producto.precio_compra ??
                0,
            ),

          precioVenta:
            Number(
              producto.precio_venta ??
                0,
            ),

          stock:
            obtenerStock(
              producto.existencias,
            ),

          stockMinimo:
            Number(
              producto.stock_minimo ??
                0,
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
    }, [productos, busqueda])

  if (cargando) {
    return (
      <div className="inventory-loading">
        <div className="inventory-spinner" />

        <span>
          Cargando productos...
        </span>
      </div>
    )
  }

  return (
    <div className="inventory-module">
      <div className="inventory-toolbar">
        <div>
          <span className="panel-label">
            CATÁLOGO DE PRODUCTOS
          </span>

          <h2>
            Productos
          </h2>

          <p>
            Administración del catálogo
            maestro de productos de
            Casa Hogar.
          </p>
        </div>

        <button
          type="button"
          className="inventory-refresh-button"
          onClick={cargarProductos}
        >
          ↻ Actualizar
        </button>
      </div>

      <div className="inventory-summary-grid">
        <article className="inventory-summary-card">
          <span>
            PRODUCTOS ACTIVOS
          </span>

          <strong>
            {productos.length}
          </strong>

          <p>
            registrados
          </p>
        </article>

        <article className="inventory-summary-card">
          <span>
            CATEGORÍAS
          </span>

          <strong>
            {
              new Set(
                productos.map(
                  (producto) =>
                    producto.categoria,
                ),
              ).size
            }
          </strong>

          <p>
            utilizadas
          </p>
        </article>

        <article className="inventory-summary-card">
          <span>
            CON EXISTENCIA
          </span>

          <strong>
            {
              productos.filter(
                (producto) =>
                  producto.stock > 0,
              ).length
            }
          </strong>

          <p>
            productos
          </p>
        </article>

        <article className="inventory-summary-card">
          <span>
            SIN EXISTENCIA
          </span>

          <strong>
            {
              productos.filter(
                (producto) =>
                  producto.stock <= 0,
              ).length
            }
          </strong>

          <p>
            productos
          </p>
        </article>
      </div>

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
            placeholder="Buscar producto por código, nombre o categoría..."
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

      {error && (
        <div className="inventory-error">
          {error}
        </div>
      )}

      {!error && (
        <div className="inventory-table-container">
          <table className="inventory-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Producto</th>
                <th>Categoría</th>
                <th>Unidad</th>
                <th>
                  Precio compra
                </th>
                <th>
                  Precio venta
                </th>
                <th>
                  Existencia
                </th>
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
                          producto.unidad
                        }
                      </td>

                      <td>
                        {formatearCordobas(
                          producto.precioCompra,
                        )}
                      </td>

                      <td>
                        {formatearCordobas(
                          producto.precioVenta,
                        )}
                      </td>

                      <td>
                        <strong className="stock-value">
                          {
                            producto.stock
                          }
                        </strong>
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