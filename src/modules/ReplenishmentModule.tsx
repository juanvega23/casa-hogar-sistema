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

type ProductoReposicion = {
  id: number
  codigo: string
  nombre: string
  categoria: string
  unidad: string
  existencia: number
  stockMinimo: number
  faltante: number
  estado:
    | 'Agotado'
    | 'Stock bajo'
    | 'En mínimo'
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

  return Number(
    relacion.cantidad ?? 0,
  )
}

function obtenerEstado(
  existencia: number,
  stockMinimo: number,
): ProductoReposicion['estado'] {
  if (existencia <= 0) {
    return 'Agotado'
  }

  if (existencia === stockMinimo) {
    return 'En mínimo'
  }

  return 'Stock bajo'
}

export default function ReplenishmentModule() {
  const [
    productos,
    setProductos,
  ] = useState<ProductoReposicion[]>([])

  const [busqueda, setBusqueda] =
    useState('')

  const [cargando, setCargando] =
    useState(true)

  const [error, setError] =
    useState('')

  async function cargarReposicion() {
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
        `No fue posible cargar la reposición: ${error.message}`,
      )

      setProductos([])
      setCargando(false)

      return
    }

    const respuesta =
      (data ??
        []) as unknown as ProductoRespuesta[]

    const lista =
      respuesta
        .map(
          (
            producto,
          ): ProductoReposicion => {
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

              unidad:
                producto.unidad_medida,

              existencia,

              stockMinimo,

              faltante:
                Math.max(
                  stockMinimo -
                    existencia,
                  0,
                ),

              estado:
                obtenerEstado(
                  existencia,
                  stockMinimo,
                ),
            }
          },
        )
        .filter(
          (producto) =>
            producto.existencia <=
            producto.stockMinimo,
        )

    setProductos(lista)
    setCargando(false)
  }

  useEffect(() => {
    cargarReposicion()
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

  const resumen =
    useMemo(() => {
      const agotados =
        productos.filter(
          (producto) =>
            producto.existencia <= 0,
        ).length

      const stockBajo =
        productos.filter(
          (producto) =>
            producto.existencia > 0 &&
            producto.existencia <
              producto.stockMinimo,
        ).length

      const enMinimo =
        productos.filter(
          (producto) =>
            producto.existencia ===
            producto.stockMinimo &&
            producto.existencia > 0,
        ).length

      const unidadesFaltantes =
        productos.reduce(
          (
            total,
            producto,
          ) =>
            total +
            producto.faltante,
          0,
        )

      return {
        total:
          productos.length,

        agotados,
        stockBajo,
        enMinimo,
        unidadesFaltantes,
      }
    }, [productos])

  if (cargando) {
    return (
      <div className="inventory-loading">
        <div className="inventory-spinner" />

        <span>
          Analizando existencias...
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
            CONTROL DE EXISTENCIAS
          </span>

          <h2>
            Reposición
          </h2>

          <p>
            Productos cuya existencia
            se encuentra en o por
            debajo del stock mínimo.
          </p>
        </div>

        <button
          type="button"
          className="inventory-refresh-button"
          onClick={cargarReposicion}
        >
          ↻ Actualizar
        </button>
      </div>

      {/* ==============================================
          INDICADORES
      ============================================== */}

      <div className="inventory-summary-grid">
        <article className="inventory-summary-card">
          <span>
            REQUIEREN ATENCIÓN
          </span>

          <strong>
            {resumen.total}
          </strong>

          <p>
            productos
          </p>
        </article>

        <article className="inventory-summary-card">
          <span>
            AGOTADOS
          </span>

          <strong>
            {resumen.agotados}
          </strong>

          <p>
            sin existencia
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
            bajo el mínimo
          </p>
        </article>

        <article className="inventory-summary-card">
          <span>
            EN EL MÍNIMO
          </span>

          <strong>
            {resumen.enMinimo}
          </strong>

          <p>
            requieren seguimiento
          </p>
        </article>
      </div>

      {/* ==============================================
          BÚSQUEDA
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
            placeholder="Buscar por código, producto o categoría..."
          />
        </div>

        <span className="inventory-result-count">
          {
            productosFiltrados.length
          }{' '}
          producto
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

      {/* ==============================================
          SIN PRODUCTOS POR REPONER
      ============================================== */}

      {!error &&
        productosFiltrados.length ===
          0 && (
          <section className="replenishment-ok-card">
            <div className="replenishment-ok-icon">
              ✓
            </div>

            <div>
              <h3>
                Inventario sin alertas
                de reposición
              </h3>

              <p>
                Actualmente no existen
                productos activos con
                existencia igual o
                inferior a su stock
                mínimo.
              </p>
            </div>
          </section>
        )}

      {/* ==============================================
          TABLA
      ============================================== */}

      {!error &&
        productosFiltrados.length >
          0 && (
          <div className="inventory-table-container">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th>Unidad</th>
                  <th>
                    Existencia
                  </th>
                  <th>
                    Stock mínimo
                  </th>
                  <th>
                    Faltante al mínimo
                  </th>
                  <th>Estado</th>
                </tr>
              </thead>

              <tbody>
                {productosFiltrados.map(
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
                        {
                          producto.faltante
                        }
                      </td>

                      <td>
                        <span
                          className={
                            producto.estado ===
                            'Agotado'
                              ? 'inventory-status inventory-status-danger'
                              : 'inventory-status inventory-status-warning'
                          }
                        >
                          {
                            producto.estado
                          }
                        </span>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}

      {/* ==============================================
          INFORMACIÓN
      ============================================== */}

      <div className="replenishment-info">
        <div>
          <span>
            Unidades faltantes para
            alcanzar mínimos
          </span>

          <strong>
            {
              resumen.unidadesFaltantes
            }
          </strong>
        </div>

        <p>
          La reposición se calcula
          comparando la existencia
          actual con el stock mínimo
          configurado en cada producto.
        </p>
      </div>
    </div>
  )
}