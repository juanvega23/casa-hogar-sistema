import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'

import { supabase } from '../lib/supabase'

type Categoria = {
  id: number
  nombre: string
}

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
  categoria_id: number
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
  categoriaId: number
  categoria: string
  unidad: string
  precioCompra: number
  precioVenta: number
  stock: number
  stockMinimo: number
}

type FormProducto = {
  codigo: string
  nombre: string
  descripcion: string
  categoriaId: string
  unidadMedida: string
  precioCompra: string
  precioVenta: string
  stockMinimo: string
}

const formularioInicial: FormProducto = {
  codigo: '',
  nombre: '',
  descripcion: '',
  categoriaId: '',
  unidadMedida: 'unidad',
  precioCompra: '',
  precioVenta: '',
  stockMinimo: '',
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

  const [categorias, setCategorias] =
    useState<Categoria[]>([])

  const [busqueda, setBusqueda] =
    useState('')

  const [cargando, setCargando] =
    useState(true)

  const [guardando, setGuardando] =
    useState(false)

  const [error, setError] =
    useState('')

  const [exito, setExito] =
    useState('')

  const [
    puedeAdministrar,
    setPuedeAdministrar,
  ] = useState(false)

  const [
    mostrarFormulario,
    setMostrarFormulario,
  ] = useState(false)

  const [
    productoEditando,
    setProductoEditando,
  ] = useState<number | null>(
    null,
  )

  const [
    formulario,
    setFormulario,
  ] = useState<FormProducto>(
    formularioInicial,
  )

  async function cargarDatos() {
    setCargando(true)
    setError('')

    const [
      productosResultado,
      categoriasResultado,
      rolResultado,
    ] = await Promise.all([
      supabase
        .from('productos')
        .select(`
          id,
          codigo,
          nombre,
          descripcion,
          categoria_id,
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
        }),

      supabase
        .from('categorias')
        .select(`
          id,
          nombre
        `)
        .order('nombre', {
          ascending: true,
        }),

      supabase.rpc(
        'current_role_code',
      ),
    ])

    if (
      productosResultado.error
    ) {
      setError(
        `No fue posible cargar los productos: ${productosResultado.error.message}`,
      )

      setCargando(false)
      return
    }

    if (
      categoriasResultado.error
    ) {
      setError(
        `No fue posible cargar las categorías: ${categoriasResultado.error.message}`,
      )

      setCargando(false)
      return
    }

    const respuesta =
      (productosResultado.data ??
        []) as unknown as ProductoRespuesta[]

    const lista =
      respuesta.map(
        (
          producto,
        ): Producto => ({
          id: producto.id,

          codigo:
            producto.codigo,

          nombre:
            producto.nombre,

          descripcion:
            producto.descripcion ??
            '',

          categoriaId:
            producto.categoria_id,

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

    setCategorias(
      (categoriasResultado.data ??
        []) as Categoria[],
    )

    setPuedeAdministrar(
      !rolResultado.error &&
        rolResultado.data ===
          'almacen',
    )

    setCargando(false)
  }

  useEffect(() => {
    cargarDatos()
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
      return {
        total:
          productos.length,

        categorias:
          new Set(
            productos.map(
              (producto) =>
                producto.categoria,
            ),
          ).size,

        conExistencia:
          productos.filter(
            (producto) =>
              producto.stock > 0,
          ).length,

        sinExistencia:
          productos.filter(
            (producto) =>
              producto.stock <= 0,
          ).length,
      }
    }, [productos])

  function actualizarFormulario(
    campo: keyof FormProducto,
    valor: string,
  ) {
    setFormulario(
      (actual) => ({
        ...actual,
        [campo]: valor,
      }),
    )
  }

  function abrirNuevoProducto() {
    setProductoEditando(null)

    setFormulario({
      ...formularioInicial,

      categoriaId:
        categorias.length > 0
          ? String(
              categorias[0].id,
            )
          : '',
    })

    setError('')
    setExito('')
    setMostrarFormulario(true)
  }

  function abrirEditarProducto(
    producto: Producto,
  ) {
    setProductoEditando(
      producto.id,
    )

    setFormulario({
      codigo:
        producto.codigo,

      nombre:
        producto.nombre,

      descripcion:
        producto.descripcion,

      categoriaId:
        String(
          producto.categoriaId,
        ),

      unidadMedida:
        producto.unidad,

      precioCompra:
        String(
          producto.precioCompra,
        ),

      precioVenta:
        String(
          producto.precioVenta,
        ),

      stockMinimo:
        String(
          producto.stockMinimo,
        ),
    })

    setError('')
    setExito('')
    setMostrarFormulario(true)
  }

  function cerrarFormulario() {
    setMostrarFormulario(false)

    setProductoEditando(null)

    setFormulario(
      formularioInicial,
    )

    setError('')
  }

  async function guardarProducto(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    setError('')
    setExito('')

    if (!puedeAdministrar) {
      setError(
        'No tienes permisos para administrar productos.',
      )

      return
    }

    const codigo =
      formulario.codigo
        .trim()
        .toUpperCase()

    const nombre =
      formulario.nombre.trim()

    const categoriaId =
      Number(
        formulario.categoriaId,
      )

    const precioCompra =
      Number(
        formulario.precioCompra,
      )

    const precioVenta =
      Number(
        formulario.precioVenta,
      )

    const stockMinimo =
      Number(
        formulario.stockMinimo,
      )

    if (
      !codigo ||
      !nombre ||
      !categoriaId ||
      !formulario.unidadMedida.trim()
    ) {
      setError(
        'Completa los campos obligatorios.',
      )

      return
    }

    if (
      !Number.isFinite(
        precioCompra,
      ) ||
      precioCompra < 0 ||
      !Number.isFinite(
        precioVenta,
      ) ||
      precioVenta < 0 ||
      !Number.isFinite(
        stockMinimo,
      ) ||
      stockMinimo < 0
    ) {
      setError(
        'Los precios y el stock mínimo deben ser valores válidos y no negativos.',
      )

      return
    }

    setGuardando(true)

    const datosProducto = {
      codigo,

      nombre,

      descripcion:
        formulario.descripcion
          .trim() ||
        null,

      categoria_id:
        categoriaId,

      unidad_medida:
        formulario.unidadMedida
          .trim(),

      precio_compra:
        precioCompra,

      precio_venta:
        precioVenta,

      stock_minimo:
        stockMinimo,
    }

    if (productoEditando) {
      const { error } =
        await supabase
          .from('productos')
          .update(
            datosProducto,
          )
          .eq(
            'id',
            productoEditando,
          )

      if (error) {
        setError(
          `No fue posible actualizar el producto: ${error.message}`,
        )

        setGuardando(false)

        return
      }

      setExito(
        'Producto actualizado correctamente.',
      )
    } else {
      const { error } =
        await supabase
          .from('productos')
          .insert({
            ...datosProducto,
            activo: true,
          })

      if (error) {
        const mensaje =
          error.code === '23505'
            ? 'Ya existe un producto con ese código.'
            : `No fue posible crear el producto: ${error.message}`

        setError(mensaje)
        setGuardando(false)

        return
      }

      setExito(
        'Producto creado correctamente.',
      )
    }

    setMostrarFormulario(false)

    setProductoEditando(null)

    setFormulario(
      formularioInicial,
    )

    await cargarDatos()

    setGuardando(false)
  }

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

        <div className="product-toolbar-actions">
          <button
            type="button"
            className="inventory-refresh-button"
            onClick={cargarDatos}
          >
            ↻ Actualizar
          </button>

          {puedeAdministrar && (
            <button
              type="button"
              className="product-primary-button"
              onClick={
                abrirNuevoProducto
              }
            >
              + Nuevo producto
            </button>
          )}
        </div>
      </div>

      <div className="inventory-summary-grid">
        <article className="inventory-summary-card">
          <span>
            PRODUCTOS ACTIVOS
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
            CATEGORÍAS
          </span>

          <strong>
            {resumen.categorias}
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
              resumen.conExistencia
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
              resumen.sinExistencia
            }
          </strong>

          <p>
            productos
          </p>
        </article>
      </div>

      {mostrarFormulario &&
        puedeAdministrar && (
          <section className="product-form-card">
            <div className="product-form-head">
              <div>
                <span className="panel-label">
                  {productoEditando
                    ? 'EDITAR PRODUCTO'
                    : 'NUEVO PRODUCTO'}
                </span>

                <h3>
                  {productoEditando
                    ? 'Actualizar producto'
                    : 'Registrar producto'}
                </h3>

                <p>
                  {productoEditando
                    ? 'Modifica los datos maestros del producto.'
                    : 'Registra un nuevo producto en el catálogo.'}
                </p>
              </div>

              <button
                type="button"
                className="product-close-button"
                onClick={
                  cerrarFormulario
                }
              >
                ×
              </button>
            </div>

            <form
              className="product-form"
              onSubmit={
                guardarProducto
              }
            >
              <div className="product-field">
                <label htmlFor="prod-codigo">
                  Código *
                </label>

                <input
                  id="prod-codigo"
                  type="text"
                  value={
                    formulario.codigo
                  }
                  onChange={(event) =>
                    actualizarFormulario(
                      'codigo',
                      event.target.value,
                    )
                  }
                  placeholder="Ej. PROD-002"
                  required
                />
              </div>

              <div className="product-field product-field--double">
                <label htmlFor="prod-nombre">
                  Nombre *
                </label>

                <input
                  id="prod-nombre"
                  type="text"
                  value={
                    formulario.nombre
                  }
                  onChange={(event) =>
                    actualizarFormulario(
                      'nombre',
                      event.target.value,
                    )
                  }
                  placeholder="Nombre del producto"
                  required
                />
              </div>

              <div className="product-field">
                <label htmlFor="prod-categoria">
                  Categoría *
                </label>

                <select
                  id="prod-categoria"
                  value={
                    formulario.categoriaId
                  }
                  onChange={(event) =>
                    actualizarFormulario(
                      'categoriaId',
                      event.target.value,
                    )
                  }
                  required
                >
                  <option value="">
                    Seleccionar
                  </option>

                  {categorias.map(
                    (categoria) => (
                      <option
                        key={
                          categoria.id
                        }
                        value={
                          categoria.id
                        }
                      >
                        {
                          categoria.nombre
                        }
                      </option>
                    ),
                  )}
                </select>
              </div>

              <div className="product-field">
                <label htmlFor="prod-unidad">
                  Unidad *
                </label>

                <input
                  id="prod-unidad"
                  type="text"
                  value={
                    formulario.unidadMedida
                  }
                  onChange={(event) =>
                    actualizarFormulario(
                      'unidadMedida',
                      event.target.value,
                    )
                  }
                  placeholder="unidad"
                  required
                />
              </div>

              <div className="product-field">
                <label htmlFor="prod-compra">
                  Precio compra
                </label>

                <input
                  id="prod-compra"
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    formulario.precioCompra
                  }
                  onChange={(event) =>
                    actualizarFormulario(
                      'precioCompra',
                      event.target.value,
                    )
                  }
                  placeholder="0.00"
                />
              </div>

              <div className="product-field">
                <label htmlFor="prod-venta">
                  Precio venta
                </label>

                <input
                  id="prod-venta"
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    formulario.precioVenta
                  }
                  onChange={(event) =>
                    actualizarFormulario(
                      'precioVenta',
                      event.target.value,
                    )
                  }
                  placeholder="0.00"
                />
              </div>

              <div className="product-field">
                <label htmlFor="prod-minimo">
                  Stock mínimo
                </label>

                <input
                  id="prod-minimo"
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    formulario.stockMinimo
                  }
                  onChange={(event) =>
                    actualizarFormulario(
                      'stockMinimo',
                      event.target.value,
                    )
                  }
                  placeholder="0"
                />
              </div>

              <div className="product-field product-field--full">
                <label htmlFor="prod-descripcion">
                  Descripción
                </label>

                <textarea
                  id="prod-descripcion"
                  value={
                    formulario.descripcion
                  }
                  onChange={(event) =>
                    actualizarFormulario(
                      'descripcion',
                      event.target.value,
                    )
                  }
                  placeholder="Descripción breve del producto"
                  rows={3}
                />
              </div>

              <div className="product-form-actions">
                <button
                  type="button"
                  className="product-secondary-button"
                  onClick={
                    cerrarFormulario
                  }
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  className="product-primary-button"
                  disabled={
                    guardando
                  }
                >
                  {guardando
                    ? 'Guardando...'
                    : productoEditando
                      ? 'Guardar cambios'
                      : 'Crear producto'}
                </button>
              </div>
            </form>
          </section>
        )}

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
                <th>
                  Stock mínimo
                </th>

                {puedeAdministrar && (
                  <th>
                    Acciones
                  </th>
                )}
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

                      <td>
                        {
                          producto.stockMinimo
                        }
                      </td>

                      {puedeAdministrar && (
                        <td>
                          <button
                            type="button"
                            className="product-edit-button"
                            onClick={() =>
                              abrirEditarProducto(
                                producto,
                              )
                            }
                          >
                            Editar
                          </button>
                        </td>
                      )}
                    </tr>
                  ),
                )
              ) : (
                <tr>
                  <td
                    colSpan={
                      puedeAdministrar
                        ? 9
                        : 8
                    }
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