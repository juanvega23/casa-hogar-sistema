import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'

import { supabase } from '../lib/supabase'

type Catalogo = {
  id: number
  nombre: string
}

type RelacionNombre = {
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
  marca_id: number | null
  modelo_id: number | null
  color_id: number | null
  material_id: number | null
  unidad_medida_id: number | null
  unidad_medida: string
  precio_compra: number
  precio_venta: number
  stock_minimo: number
  activo: boolean

  categorias:
    | RelacionNombre
    | RelacionNombre[]
    | null

  marca:
    | RelacionNombre
    | RelacionNombre[]
    | null

  modelo:
    | RelacionNombre
    | RelacionNombre[]
    | null

  color:
    | RelacionNombre
    | RelacionNombre[]
    | null

  material:
    | RelacionNombre
    | RelacionNombre[]
    | null

  unidad_catalogo:
    | RelacionNombre
    | RelacionNombre[]
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

  marcaId: number | null
  marca: string

  modeloId: number | null
  modelo: string

  colorId: number | null
  color: string

  materialId: number | null
  material: string

  unidadMedidaId: number | null
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
  marcaId: string
  modeloId: string
  colorId: string
  materialId: string
  unidadMedidaId: string

  precioCompra: string
  precioVenta: string
  stockMinimo: string
}

const formularioInicial: FormProducto = {
  codigo: '',
  nombre: '',
  descripcion: '',

  categoriaId: '',
  marcaId: '',
  modeloId: '',
  colorId: '',
  materialId: '',
  unidadMedidaId: '',

  precioCompra: '',
  precioVenta: '',
  stockMinimo: '',
}

function obtenerNombreRelacion(
  relacion:
    | RelacionNombre
    | RelacionNombre[]
    | null,
  valorPorDefecto = 'Sin especificar',
) {
  if (!relacion) {
    return valorPorDefecto
  }

  if (Array.isArray(relacion)) {
    return (
      relacion[0]?.nombre ??
      valorPorDefecto
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
    return relacion.reduce(
      (total, existencia) =>
        total +
        Number(existencia.cantidad ?? 0),
      0,
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

function idOpcional(
  valor: string,
) {
  if (!valor) {
    return null
  }

  const numero = Number(valor)

  return Number.isFinite(numero)
    ? numero
    : null
}

export default function ProductsModule() {
  const [productos, setProductos] =
    useState<Producto[]>([])

  const [categorias, setCategorias] =
    useState<Catalogo[]>([])

  const [marcas, setMarcas] =
    useState<Catalogo[]>([])

  const [modelos, setModelos] =
    useState<Catalogo[]>([])

  const [colores, setColores] =
    useState<Catalogo[]>([])

  const [materiales, setMateriales] =
    useState<Catalogo[]>([])

  const [
    unidadesMedida,
    setUnidadesMedida,
  ] = useState<Catalogo[]>([])

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
      marcasResultado,
      modelosResultado,
      coloresResultado,
      materialesResultado,
      unidadesResultado,
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
          marca_id,
          modelo_id,
          color_id,
          material_id,
          unidad_medida_id,
          unidad_medida,
          precio_compra,
          precio_venta,
          stock_minimo,
          activo,
          categorias (
            nombre
          ),
          marca:marcas (
            nombre
          ),
          modelo:modelos (
            nombre
          ),
          color:colores (
            nombre
          ),
          material:materiales (
            nombre
          ),
          unidad_catalogo:unidades_medida (
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

      supabase
        .from('marcas')
        .select(`
          id,
          nombre
        `)
        .eq('activo', true)
        .order('nombre', {
          ascending: true,
        }),

      supabase
        .from('modelos')
        .select(`
          id,
          nombre
        `)
        .eq('activo', true)
        .order('nombre', {
          ascending: true,
        }),

      supabase
        .from('colores')
        .select(`
          id,
          nombre
        `)
        .eq('activo', true)
        .order('nombre', {
          ascending: true,
        }),

      supabase
        .from('materiales')
        .select(`
          id,
          nombre
        `)
        .eq('activo', true)
        .order('nombre', {
          ascending: true,
        }),

      supabase
        .from('unidades_medida')
        .select(`
          id,
          nombre
        `)
        .eq('activo', true)
        .order('nombre', {
          ascending: true,
        }),

      supabase.rpc(
        'current_role_code',
      ),
    ])

    const errores = [
      [
        productosResultado.error,
        'productos',
      ],
      [
        categoriasResultado.error,
        'categorías',
      ],
      [
        marcasResultado.error,
        'marcas',
      ],
      [
        modelosResultado.error,
        'modelos',
      ],
      [
        coloresResultado.error,
        'colores',
      ],
      [
        materialesResultado.error,
        'materiales',
      ],
      [
        unidadesResultado.error,
        'unidades de medida',
      ],
    ] as const

    const primerError =
      errores.find(
        ([resultadoError]) =>
          Boolean(resultadoError),
      )

    if (primerError) {
      const [
        resultadoError,
        nombreCatalogo,
      ] = primerError

      setError(
        `No fue posible cargar ${nombreCatalogo}: ${resultadoError?.message ?? 'Error desconocido.'}`,
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
          codigo: producto.codigo,
          nombre: producto.nombre,

          descripcion:
            producto.descripcion ??
            '',

          categoriaId:
            producto.categoria_id,

          categoria:
            obtenerNombreRelacion(
              producto.categorias,
              'Sin categoría',
            ),

          marcaId:
            producto.marca_id,

          marca:
            obtenerNombreRelacion(
              producto.marca,
            ),

          modeloId:
            producto.modelo_id,

          modelo:
            obtenerNombreRelacion(
              producto.modelo,
            ),

          colorId:
            producto.color_id,

          color:
            obtenerNombreRelacion(
              producto.color,
            ),

          materialId:
            producto.material_id,

          material:
            obtenerNombreRelacion(
              producto.material,
            ),

          unidadMedidaId:
            producto.unidad_medida_id,

          unidad:
            obtenerNombreRelacion(
              producto.unidad_catalogo,
              producto.unidad_medida ||
                'Sin unidad',
            ),

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
        []) as Catalogo[],
    )

    setMarcas(
      (marcasResultado.data ??
        []) as Catalogo[],
    )

    setModelos(
      (modelosResultado.data ??
        []) as Catalogo[],
    )

    setColores(
      (coloresResultado.data ??
        []) as Catalogo[],
    )

    setMateriales(
      (materialesResultado.data ??
        []) as Catalogo[],
    )

    setUnidadesMedida(
      (unidadesResultado.data ??
        []) as Catalogo[],
    )

    const rolActual =
      rolResultado.error
        ? ''
        : String(
            rolResultado.data ?? '',
          )

    setPuedeAdministrar(
      [
        'almacen',
        'administracion',
      ].includes(rolActual),
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
            .includes(termino) ||
          producto.marca
            .toLowerCase()
            .includes(termino) ||
          producto.modelo
            .toLowerCase()
            .includes(termino) ||
          producto.color
            .toLowerCase()
            .includes(termino) ||
          producto.material
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

    const unidadPorDefecto =
      unidadesMedida.find(
        (unidad) =>
          unidad.nombre
            .trim()
            .toLowerCase() ===
          'unidad',
      ) ??
      unidadesMedida[0]

    setFormulario({
      ...formularioInicial,

      categoriaId:
        categorias.length > 0
          ? String(
              categorias[0].id,
            )
          : '',

      unidadMedidaId:
        unidadPorDefecto
          ? String(
              unidadPorDefecto.id,
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

    const unidadRelacionada =
      producto.unidadMedidaId ??
      unidadesMedida.find(
        (unidad) =>
          unidad.nombre
            .trim()
            .toLowerCase() ===
          producto.unidad
            .trim()
            .toLowerCase(),
      )?.id ??
      null

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

      marcaId:
        producto.marcaId
          ? String(
              producto.marcaId,
            )
          : '',

      modeloId:
        producto.modeloId
          ? String(
              producto.modeloId,
            )
          : '',

      colorId:
        producto.colorId
          ? String(
              producto.colorId,
            )
          : '',

      materialId:
        producto.materialId
          ? String(
              producto.materialId,
            )
          : '',

      unidadMedidaId:
        unidadRelacionada
          ? String(
              unidadRelacionada,
            )
          : '',

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

    const unidadMedidaId =
      Number(
        formulario.unidadMedidaId,
      )

    const precioCompra =
      Number(
        formulario.precioCompra ||
          0,
      )

    const precioVenta =
      Number(
        formulario.precioVenta ||
          0,
      )

    const stockMinimo =
      Number(
        formulario.stockMinimo ||
          0,
      )

    if (
      !codigo ||
      !nombre ||
      !categoriaId ||
      !unidadMedidaId
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

    const unidadSeleccionada =
      unidadesMedida.find(
        (unidad) =>
          unidad.id ===
          unidadMedidaId,
      )

    if (!unidadSeleccionada) {
      setError(
        'Selecciona una unidad de medida válida.',
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

      marca_id:
        idOpcional(
          formulario.marcaId,
        ),

      modelo_id:
        idOpcional(
          formulario.modeloId,
        ),

      color_id:
        idOpcional(
          formulario.colorId,
        ),

      material_id:
        idOpcional(
          formulario.materialId,
        ),

      unidad_medida_id:
        unidadMedidaId,

      // Se conserva temporalmente para no romper
      // Compras, Ventas y otros módulos actuales.
      unidad_medida:
        unidadSeleccionada.nombre,

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
                  placeholder="Ej. PROD-003"
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
                <label htmlFor="prod-marca">
                  Marca
                </label>

                <select
                  id="prod-marca"
                  value={
                    formulario.marcaId
                  }
                  onChange={(event) =>
                    actualizarFormulario(
                      'marcaId',
                      event.target.value,
                    )
                  }
                >
                  <option value="">
                    Sin especificar
                  </option>

                  {marcas.map(
                    (marca) => (
                      <option
                        key={marca.id}
                        value={marca.id}
                      >
                        {marca.nombre}
                      </option>
                    ),
                  )}
                </select>
              </div>

              <div className="product-field">
                <label htmlFor="prod-modelo">
                  Modelo
                </label>

                <select
                  id="prod-modelo"
                  value={
                    formulario.modeloId
                  }
                  onChange={(event) =>
                    actualizarFormulario(
                      'modeloId',
                      event.target.value,
                    )
                  }
                >
                  <option value="">
                    Sin especificar
                  </option>

                  {modelos.map(
                    (modelo) => (
                      <option
                        key={modelo.id}
                        value={modelo.id}
                      >
                        {modelo.nombre}
                      </option>
                    ),
                  )}
                </select>
              </div>

              <div className="product-field">
                <label htmlFor="prod-color">
                  Color
                </label>

                <select
                  id="prod-color"
                  value={
                    formulario.colorId
                  }
                  onChange={(event) =>
                    actualizarFormulario(
                      'colorId',
                      event.target.value,
                    )
                  }
                >
                  <option value="">
                    Sin especificar
                  </option>

                  {colores.map(
                    (color) => (
                      <option
                        key={color.id}
                        value={color.id}
                      >
                        {color.nombre}
                      </option>
                    ),
                  )}
                </select>
              </div>

              <div className="product-field">
                <label htmlFor="prod-material">
                  Material
                </label>

                <select
                  id="prod-material"
                  value={
                    formulario.materialId
                  }
                  onChange={(event) =>
                    actualizarFormulario(
                      'materialId',
                      event.target.value,
                    )
                  }
                >
                  <option value="">
                    Sin especificar
                  </option>

                  {materiales.map(
                    (material) => (
                      <option
                        key={
                          material.id
                        }
                        value={
                          material.id
                        }
                      >
                        {
                          material.nombre
                        }
                      </option>
                    ),
                  )}
                </select>
              </div>

              <div className="product-field">
                <label htmlFor="prod-unidad">
                  Unidad de medida *
                </label>

                <select
                  id="prod-unidad"
                  value={
                    formulario.unidadMedidaId
                  }
                  onChange={(event) =>
                    actualizarFormulario(
                      'unidadMedidaId',
                      event.target.value,
                    )
                  }
                  required
                >
                  <option value="">
                    Seleccionar
                  </option>

                  {unidadesMedida.map(
                    (unidad) => (
                      <option
                        key={unidad.id}
                        value={unidad.id}
                      >
                        {unidad.nombre}
                      </option>
                    ),
                  )}
                </select>
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
            placeholder="Buscar por código, producto, categoría, marca, modelo, color o material..."
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
                <th>Características</th>
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
                        <div>
                          Marca:{' '}
                          {
                            producto.marca
                          }
                        </div>
                        <div>
                          Modelo:{' '}
                          {
                            producto.modelo
                          }
                        </div>
                        <div>
                          Color:{' '}
                          {
                            producto.color
                          }
                        </div>
                        <div>
                          Material:{' '}
                          {
                            producto.material
                          }
                        </div>
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
                        ? 10
                        : 9
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
